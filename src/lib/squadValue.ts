import { gunzipSync } from 'zlib';
import { unstable_cache } from 'next/cache';
import { parse } from 'csv-parse/sync';

// dcaribou/transfermarkt-datasets (the pipeline behind Kaggle's
// davidcariboo/player-scores) publishes its weekly-refreshed CSVs directly
// from this public R2 bucket — no Kaggle account/API key needed.
const PLAYERS_CSV_URL = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz';
const NATIONAL_TEAMS_CSV_URL = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/national_teams.csv.gz';

interface PlayerRow {
  current_national_team_id: string;
  market_value_in_eur: string;
}

interface NationalTeamRow {
  national_team_id: string;
  country_name: string;
  fifa_ranking: string;
}

// The R2 files are gzip *content* (Content-Type: application/gzip, no
// Content-Encoding header) — fetch() will not auto-decompress these the way
// it does with transport-level gzip, so this needs an explicit gunzip.
async function fetchGzippedCsv(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return gunzipSync(buf).toString('utf-8');
  } catch {
    return null;
  }
}

export interface SquadInfo {
  totalValueEur: number;
  playerCount: number;
  fifaRanking: number | null;
}

// Parsing ~48k player rows out of a ~17MB file is expensive relative to how
// rarely this weekly-refreshed dataset actually changes — cache the
// computed per-country result itself (tiny: one entry per country), not
// just the raw fetch, so the parse only runs once per revalidate window.
async function computeSquadValues(): Promise<Map<string, SquadInfo>> {
  const [playersText, teamsText] = await Promise.all([
    fetchGzippedCsv(PLAYERS_CSV_URL),
    fetchGzippedCsv(NATIONAL_TEAMS_CSV_URL),
  ]);
  if (!playersText || !teamsText) return new Map();

  const teamRows = parse(teamsText, { columns: true, skip_empty_lines: true }) as NationalTeamRow[];
  const playerRows = parse(playersText, { columns: true, skip_empty_lines: true }) as PlayerRow[];

  // national_teams.csv has its own pre-aggregated total_market_value column,
  // but it's null for several major teams (confirmed: France, England,
  // Spain, Portugal) despite those squads being fully present in
  // players.csv — so the total is computed here from player rows instead of
  // trusted from that column.
  //
  // current_national_team_id tags every player in a country's broader
  // senior-team-eligible pool, not just a 26-man tournament roster (verified:
  // Morocco alone has 82 tagged players) — summing the full pool overstates
  // real squad value by 25-65% against Transfermarkt's own published totals
  // for the teams where that ground truth is available. Capping to the
  // top-by-value SQUAD_SIZE players per team approximates an actual World
  // Cup squad without needing a real roster source; still runs ~20-35% over
  // ground truth (some high-value players don't make the actual squad, some
  // lower-value role players do) but is much closer than the uncapped pool.
  const SQUAD_SIZE = 26;
  const valuesByTeamId = new Map<string, number[]>();
  for (const p of playerRows) {
    if (!p.current_national_team_id || !p.market_value_in_eur) continue;
    const value = parseInt(p.market_value_in_eur, 10);
    if (!Number.isFinite(value)) continue;
    const list = valuesByTeamId.get(p.current_national_team_id) ?? [];
    list.push(value);
    valuesByTeamId.set(p.current_national_team_id, list);
  }

  const totals = new Map<string, { totalValueEur: number; playerCount: number }>();
  for (const [teamId, values] of valuesByTeamId) {
    const topValues = values.sort((a, b) => b - a).slice(0, SQUAD_SIZE);
    totals.set(teamId, {
      totalValueEur: topValues.reduce((sum, v) => sum + v, 0),
      playerCount: topValues.length,
    });
  }

  const byCountryName = new Map<string, SquadInfo>();
  for (const t of teamRows) {
    const totalsForTeam = totals.get(t.national_team_id);
    if (!totalsForTeam) continue;
    const fifaRanking = t.fifa_ranking ? parseInt(t.fifa_ranking, 10) : null;
    byCountryName.set(t.country_name.toLowerCase(), {
      totalValueEur: totalsForTeam.totalValueEur,
      playerCount: totalsForTeam.playerCount,
      fifaRanking: Number.isFinite(fifaRanking) ? fifaRanking : null,
    });
  }
  return byCountryName;
}

const getCachedSquadValues = unstable_cache(
  async () => Array.from((await computeSquadValues()).entries()),
  ['sports-picks-squad-values'],
  { revalidate: 86400 }
);

// Confirmed real mismatches between The Odds API's team names and this
// dataset's country_name column — The Odds API uses "USA"/"South Korea",
// this dataset uses "United States"/"Korea, South". Not a speculative table:
// every other 2026 World Cup team name checked matched directly.
const TEAM_NAME_ALIASES: Record<string, string> = {
  usa: 'united states',
  'south korea': 'korea, south',
};

export async function getSquadInfo(teamName: string): Promise<SquadInfo | null> {
  const entries = await getCachedSquadValues();
  const key = teamName.toLowerCase();
  const lookupKey = TEAM_NAME_ALIASES[key] ?? key;
  const match = entries.find(([name]) => name === lookupKey);
  return match ? match[1] : null;
}

export function formatSquadValue(info: SquadInfo | null): string | null {
  if (!info) return null;
  const millions = Math.round(info.totalValueEur / 1_000_000);
  const rankingPart = info.fifaRanking !== null ? `, FIFA #${info.fifaRanking}` : '';
  return `€${millions}M (${info.playerCount} players${rankingPart})`;
}

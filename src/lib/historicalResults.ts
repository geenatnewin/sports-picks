import { unstable_cache } from 'next/cache';
import { parse } from 'csv-parse/sync';

const RESULTS_CSV_URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';

interface ResultRow {
  date: string;
  home_team: string;
  away_team: string;
  home_score: string;
  away_score: string;
  tournament: string;
}

async function fetchResults(): Promise<ResultRow[]> {
  try {
    const res = await fetch(RESULTS_CSV_URL, { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const text = await res.text();
    return parse(text, { columns: true, skip_empty_lines: true }) as ResultRow[];
  } catch {
    return [];
  }
}

// Parsing ~49k rows is expensive relative to how rarely this CC0 dataset
// changes (community-maintained, infrequent commits) — cache the parsed
// result itself, not just the raw fetch, so the parse only runs once per
// revalidate window instead of once per request.
const getCachedResults = unstable_cache(fetchResults, ['sports-picks-historical-results'], {
  revalidate: 86400,
});

export interface HeadToHeadMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  tournament: string;
}

// This dataset itself labels the USA inconsistently across eras — some rows
// use "USA", others "United States" for the same team — so treat known
// variant groups as equivalent rather than assuming the source data (or the
// name passed in from The Odds API) uses one consistent spelling.
const TEAM_NAME_GROUPS: string[][] = [['usa', 'united states']];

function sameTeam(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  return TEAM_NAME_GROUPS.some((group) => group.includes(x) && group.includes(y));
}

// Both team names in either home/away order — head-to-head history doesn't
// care which side hosted a given past meeting.
function isMatchup(row: ResultRow, teamA: string, teamB: string): boolean {
  return (
    (sameTeam(row.home_team, teamA) && sameTeam(row.away_team, teamB)) ||
    (sameTeam(row.home_team, teamB) && sameTeam(row.away_team, teamA))
  );
}

export async function getHeadToHead(teamA: string, teamB: string, limit = 5): Promise<HeadToHeadMatch[] | null> {
  const results = await getCachedResults();
  const meetings = results
    .filter((r) => isMatchup(r, teamA, teamB))
    .map((r) => ({
      date: r.date,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      homeScore: parseInt(r.home_score, 10),
      awayScore: parseInt(r.away_score, 10),
      tournament: r.tournament,
    }))
    .sort((x, y) => (x.date < y.date ? 1 : -1))
    .slice(0, limit);

  return meetings.length > 0 ? meetings : null;
}

export function summarizeHeadToHead(meetings: HeadToHeadMatch[] | null): string | null {
  if (!meetings) return null;
  return meetings
    .map((m) => `${m.date}: ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} (${m.tournament})`)
    .join(' | ');
}

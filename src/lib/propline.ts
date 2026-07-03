import { formatAmericanOdds } from './odds';

const BASE = 'https://api.prop-line.com/v1';
const KEY = process.env.PROPLINE_API_KEY;

interface PropLineEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
}

interface PropLineOutcome {
  name: string;
  price: number;
}

interface PropLineOdds {
  bookmakers: { markets: { key: string; outcomes: PropLineOutcome[] }[] }[] | null;
}

export interface PlayerProps {
  anytimeScorers: string | null;
  twoPlusAssists: string | null;
}

export interface MlbPlayerProps {
  homeRuns: string | null;
  pitcherStrikeouts: string | null;
}

// Best (lowest/most-favorable) price per player across all bookmakers for a
// given market, capped to the most credible `limit` candidates — keeps the
// AI prompt compact instead of listing every player on both rosters.
function topOutcomes(odds: PropLineOdds, marketKey: string, limit: number): string | null {
  const bestByPlayer = new Map<string, number>();
  for (const book of odds.bookmakers ?? []) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes) {
      const existing = bestByPlayer.get(outcome.name);
      if (existing === undefined || outcome.price < existing) bestByPlayer.set(outcome.name, outcome.price);
    }
  }
  if (bestByPlayer.size === 0) return null;
  return Array.from(bestByPlayer.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([name, price]) => `${name}: ${formatAmericanOdds(price)}`)
    .join(' | ');
}

// Shared by sport-specific wrappers below — fetches PropLine's event list for
// a sport, matches it to the given matches by team name (PropLine uses its
// own event IDs, unrelated to The Odds API's), then pulls the requested
// markets' odds for each matched event.
async function getPlayerPropsForSport(
  sportKey: string,
  matches: { homeTeam: string; awayTeam: string }[],
  markets: { key: string; limit: number }[]
): Promise<Map<string, Map<string, string | null>>> {
  const result = new Map<string, Map<string, string | null>>();
  if (!KEY || matches.length === 0) return result;

  try {
    const res = await fetch(`${BASE}/sports/${sportKey}/events`, {
      headers: { 'X-API-Key': KEY },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return result;
    const events: PropLineEvent[] = await res.json();

    const norm = (s: string) => s.trim().toLowerCase();
    for (const match of matches) {
      const event = events.find(
        (e) => norm(e.home_team) === norm(match.homeTeam) && norm(e.away_team) === norm(match.awayTeam)
      );
      if (!event) continue;

      const marketKeys = markets.map((m) => m.key).join(',');
      const oddsRes = await fetch(`${BASE}/sports/${sportKey}/events/${event.id}/odds?markets=${marketKeys}`, {
        headers: { 'X-API-Key': KEY },
        next: { revalidate: 1800 },
      }).catch(() => null);
      if (!oddsRes?.ok) continue;
      const odds: PropLineOdds = await oddsRes.json();

      const byMarket = new Map<string, string | null>();
      for (const m of markets) byMarket.set(m.key, topOutcomes(odds, m.key, m.limit));
      result.set(`${match.homeTeam} vs ${match.awayTeam}`, byMarket);
    }
  } catch {
    // Player props are a nice-to-have addition — fail quietly and let picks
    // generation continue on match-level markets only.
  }

  return result;
}

// Fetches anytime-goalscorer and 2+ assists props for whichever World Cup
// matches are currently being shown. Only pulls two markets, capped to a
// handful of the most likely candidates each, to keep the AI prompt small —
// skips PropLine's exotic "scorer assisted by X" combo market and the
// too-sparse "goal or assist" market as not worth the tokens.
export async function getWorldCupPlayerProps(
  matches: { homeTeam: string; awayTeam: string }[]
): Promise<Map<string, PlayerProps>> {
  const raw = await getPlayerPropsForSport('soccer_fifa_world_cup', matches, [
    { key: 'anytime_goal_scorer', limit: 5 },
    { key: 'player_2plus_assists', limit: 3 },
  ]);
  const result = new Map<string, PlayerProps>();
  for (const [event, byMarket] of raw) {
    result.set(event, {
      anytimeScorers: byMarket.get('anytime_goal_scorer') ?? null,
      twoPlusAssists: byMarket.get('player_2plus_assists') ?? null,
    });
  }
  return result;
}

// Same pattern for MLB: anytime home run and (starting) pitcher strikeouts —
// the two most standard MLB player props, same "cap it small" approach.
export async function getMlbPlayerProps(
  matches: { homeTeam: string; awayTeam: string }[]
): Promise<Map<string, MlbPlayerProps>> {
  const raw = await getPlayerPropsForSport('baseball_mlb', matches, [
    { key: 'batter_home_runs', limit: 5 },
    { key: 'pitcher_strikeouts', limit: 4 },
  ]);
  const result = new Map<string, MlbPlayerProps>();
  for (const [event, byMarket] of raw) {
    result.set(event, {
      homeRuns: byMarket.get('batter_home_runs') ?? null,
      pitcherStrikeouts: byMarket.get('pitcher_strikeouts') ?? null,
    });
  }
  return result;
}

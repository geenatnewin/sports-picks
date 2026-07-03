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

// Fetches anytime-goalscorer and 2+ assists props for whichever World Cup
// matches are currently being shown, matched to them by team names (PropLine
// uses its own event IDs, unrelated to The Odds API's). Only pulls two
// markets, capped to a handful of the most likely candidates each, to keep
// the AI prompt small — skips PropLine's exotic "scorer assisted by X" combo
// market and the too-sparse "goal or assist" market as not worth the tokens.
export async function getWorldCupPlayerProps(
  matches: { homeTeam: string; awayTeam: string }[]
): Promise<Map<string, PlayerProps>> {
  const result = new Map<string, PlayerProps>();
  if (!KEY || matches.length === 0) return result;

  try {
    const res = await fetch(`${BASE}/sports/soccer_fifa_world_cup/events`, {
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

      const oddsRes = await fetch(
        `${BASE}/sports/soccer_fifa_world_cup/events/${event.id}/odds?markets=anytime_goal_scorer,player_2plus_assists`,
        { headers: { 'X-API-Key': KEY }, next: { revalidate: 1800 } }
      ).catch(() => null);
      if (!oddsRes?.ok) continue;
      const odds: PropLineOdds = await oddsRes.json();

      result.set(`${match.homeTeam} vs ${match.awayTeam}`, {
        anytimeScorers: topOutcomes(odds, 'anytime_goal_scorer', 5),
        twoPlusAssists: topOutcomes(odds, 'player_2plus_assists', 3),
      });
    }
  } catch {
    // Player props are a nice-to-have addition — fail quietly and let picks
    // generation continue on match-level markets only.
  }

  return result;
}

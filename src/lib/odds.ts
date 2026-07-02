import { OddsGame } from './types';

const BASE = 'https://api.the-odds-api.com/v4';
const KEY = process.env.ODDS_API_KEY;

// Only show matches happening today through this many days ahead.
const MAX_DAYS_AHEAD = 1;

// "Today"/"tomorrow" are always anchored to US Eastern time, regardless of
// what timezone the server process itself runs in (Vercel runs UTC, which
// can already be a calendar day ahead of Eastern near the day boundary).
function nyDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export async function getWorldCupOdds(): Promise<OddsGame[]> {
  if (!KEY) return [];
  try {
    const res = await fetch(
      `${BASE}/sports/soccer_fifa_world_cup/odds?apiKey=${KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return [];
    const games: OddsGame[] = await res.json();

    const now = new Date();
    const todayKey = nyDateKey(now);
    const cutoffKey = nyDateKey(new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000));

    return games.filter((g) => {
      const kickoff = new Date(g.commence_time);
      if (kickoff < now) return false;
      const kickoffKey = nyDateKey(kickoff);
      return kickoffKey >= todayKey && kickoffKey <= cutoffKey;
    });
  } catch {
    return [];
  }
}

export async function getGolfOdds(): Promise<{ tournament: string; games: OddsGame[] } | null> {
  if (!KEY) return null;
  // Try active golf tournaments in order of likelihood
  const candidates = [
    'golf_the_open_championship',
    'golf_pga_championship',
    'golf_us_open',
    'golf_masters_tournament',
    'golf_pga_tour',
  ];
  for (const sport of candidates) {
    try {
      const res = await fetch(
        `${BASE}/sports/${sport}/odds?apiKey=${KEY}&regions=us&markets=outrights&oddsFormat=american`,
        { next: { revalidate: 3600 } }
      );
      if (!res.ok) continue;
      const games: OddsGame[] = await res.json();
      if (games.length > 0) return { tournament: sport, games };
    } catch {
      continue;
    }
  }
  return null;
}

export function formatAmericanOdds(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

// Pull best available line from bookmakers for a given market
export function getBestLine(game: OddsGame, marketKey: string) {
  for (const book of game.bookmakers) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (market) return market.outcomes;
  }
  return null;
}

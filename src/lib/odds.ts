import { OddsGame } from './types';

const BASE = 'https://api.the-odds-api.com/v4';
const KEY = process.env.ODDS_API_KEY;

// "Today" is always anchored to US Eastern time, regardless of what
// timezone the server process itself runs in (Vercel runs UTC, which can
// already be a calendar day ahead of Eastern near the day boundary).
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

    // Only games that haven't started yet, earliest first
    const upcoming = games
      .filter((g) => new Date(g.commence_time) >= now)
      .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

    const todaysGames = upcoming.filter((g) => nyDateKey(new Date(g.commence_time)) === todayKey);
    if (todaysGames.length > 0) return todaysGames;

    // No games today — show just the single next upcoming game, nothing further out.
    return upcoming.length > 0 ? [upcoming[0]] : [];
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

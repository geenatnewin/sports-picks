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

interface RawScoreEntry {
  id: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
}

// Shared by getCompletedMatchIds (drops finished matches from the odds list)
// and getFinishedScores (grades AI picks against real results) so both pull
// from the same cached fetch instead of hitting the API twice. daysFrom=3
// covers grading stragglers a bit further back than the 1-day window the
// odds-filtering use case strictly needs.
async function getScoresSnapshot(sportKey: string): Promise<RawScoreEntry[]> {
  if (!KEY) return [];
  try {
    const res = await fetch(
      `${BASE}/sports/${sportKey}/scores/?apiKey=${KEY}&daysFrom=3`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// The odds endpoint alone can't tell us whether a match that already kicked
// off is still in play or has finished, so we cross-check against the scores
// endpoint's `completed` flag.
async function getCompletedMatchIds(sportKey: string): Promise<Set<string>> {
  const scores = await getScoresSnapshot(sportKey);
  return new Set(scores.filter((s) => s.completed).map((s) => s.id));
}

export interface FinishedScore {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

// Real final scores for completed matches, used to grade AI picks after the
// fact — separate from getCompletedMatchIds, which only needs the boolean.
async function getFinishedScoresForSport(sportKey: string): Promise<FinishedScore[]> {
  const scores = await getScoresSnapshot(sportKey);
  const out: FinishedScore[] = [];
  for (const s of scores) {
    if (!s.completed || !s.scores) continue;
    const home = s.scores.find((sc) => sc.name === s.home_team);
    const away = s.scores.find((sc) => sc.name === s.away_team);
    if (!home || !away) continue;
    out.push({
      gameId: s.id,
      homeTeam: s.home_team,
      awayTeam: s.away_team,
      homeScore: parseInt(home.score, 10),
      awayScore: parseInt(away.score, 10),
    });
  }
  return out;
}

export function getFinishedScores(): Promise<FinishedScore[]> {
  return getFinishedScoresForSport('soccer_fifa_world_cup');
}

async function getOddsForSport(sportKey: string): Promise<OddsGame[]> {
  if (!KEY) return [];
  try {
    // FanDuel/DraftKings are the priority books, but we also shop a handful
    // of other major regulated US sportsbooks for the best price. Up to 10
    // bookmakers bills as 1 "region" on The Odds API, same cost as just 2.
    const [res, completedIds] = await Promise.all([
      fetch(
        `${BASE}/sports/${sportKey}/odds?apiKey=${KEY}&bookmakers=fanduel,draftkings,betmgm,williamhill_us,espnbet&markets=h2h,spreads,totals,draw_no_bet&oddsFormat=american`,
        { next: { revalidate: 1800 } }
      ),
      getCompletedMatchIds(sportKey),
    ]);
    if (!res.ok) return [];
    const games: OddsGame[] = await res.json();

    const now = new Date();
    const todayKey = nyDateKey(now);

    // Keep in-play matches (commence_time already passed) alongside upcoming
    // ones — only drop matches the scores endpoint confirms are completed.
    const notFinished = games
      .filter((g) => !completedIds.has(g.id))
      .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

    const todaysGames = notFinished.filter((g) => nyDateKey(new Date(g.commence_time)) === todayKey);
    if (todaysGames.length > 0) return todaysGames;

    const upcoming = notFinished.filter((g) => new Date(g.commence_time) >= now);
    if (upcoming.length === 0) return [];

    // No games today — show just the single next upcoming game, nothing further out.
    return [upcoming[0]];
  } catch {
    return [];
  }
}

export function getWorldCupOdds(): Promise<OddsGame[]> {
  return getOddsForSport('soccer_fifa_world_cup');
}

export function formatAmericanOdds(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

// Sportsbooks label the tied-match outcome "Draw" — we display it as "Tie" everywhere.
export function normalizeOutcomeName(name: string): string {
  return name === 'Draw' ? 'Tie' : name;
}

function impliedProbabilityPct(price: number): number {
  return price > 0 ? (100 / (price + 100)) * 100 : (-price / (-price + 100)) * 100;
}

// A 2-book "wide spread" is just noise — only treat this as a signal once
// enough books are quoting the same outcome to make disagreement meaningful.
const MIN_BOOKS_FOR_DIVERGENCE_SIGNAL = 3;
// Major-market moneyline books normally cluster within a few points of each
// other's implied probability on the same outcome. A double-digit spread is
// unusual enough to be worth flagging as a soft "line looks off" signal —
// NOT proof of anything on its own (see integrity-monitoring services for
// what actual fixing detection requires: account-level betting data this
// app has no access to).
const DIVERGENCE_THRESHOLD_PCT = 12;

export interface LineDivergence {
  flagged: boolean;
  maxSpreadPct: number;
  outcome: string | null;
}

// Flags matches where bookmakers disagree unusually widely on the same
// outcome's implied win probability. This is one of the cheap, DIY signals
// real integrity-monitoring firms also watch for (alongside things this app
// can't see, like account-level bet volume) — a soft "something's off here"
// flag, not a claim about which side is favored or whether anything is fixed.
export function getLineDivergence(game: OddsGame, marketKey: string): LineDivergence {
  const pricesByOutcome = new Map<string, number[]>();

  for (const book of game.bookmakers) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes) {
      const key = `${outcome.name}|${outcome.point ?? ''}`;
      const list = pricesByOutcome.get(key) ?? [];
      list.push(outcome.price);
      pricesByOutcome.set(key, list);
    }
  }

  let maxSpreadPct = 0;
  let worstOutcome: string | null = null;

  for (const [key, prices] of pricesByOutcome) {
    if (prices.length < MIN_BOOKS_FOR_DIVERGENCE_SIGNAL) continue;
    const probs = prices.map(impliedProbabilityPct);
    const spread = Math.max(...probs) - Math.min(...probs);
    if (spread > maxSpreadPct) {
      maxSpreadPct = spread;
      worstOutcome = key.split('|')[0];
    }
  }

  return {
    flagged: maxSpreadPct >= DIVERGENCE_THRESHOLD_PCT,
    maxSpreadPct: Math.round(maxSpreadPct * 10) / 10,
    outcome: worstOutcome ? normalizeOutcomeName(worstOutcome) : null,
  };
}

// Shop across every bookmaker for the best (most favorable to the bettor)
// price on each outcome — a higher price is always better, whether it's
// positive (+150 beats +120) or negative (-110 beats -150).
export function getBestLine(game: OddsGame, marketKey: string) {
  const bestByOutcome = new Map<string, { name: string; price: number; point?: number }>();

  for (const book of game.bookmakers) {
    const market = book.markets.find((m) => m.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes) {
      const key = `${outcome.name}|${outcome.point ?? ''}`;
      const existing = bestByOutcome.get(key);
      if (!existing || outcome.price > existing.price) {
        bestByOutcome.set(key, outcome);
      }
    }
  }

  return bestByOutcome.size > 0 ? Array.from(bestByOutcome.values()) : null;
}

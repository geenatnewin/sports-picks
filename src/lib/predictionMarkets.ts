// Pulls implied win probabilities from prediction markets (Kalshi, Polymarket)
// to supplement sportsbook odds. Both are public, no-auth read endpoints.

export interface MarketOutcome {
  label: string;
  probability: number; // 0-100
}

export interface MatchPredictionMarkets {
  polymarket: MarketOutcome[] | null;
  kalshi: MarketOutcome[] | null;
}

function matchesTeams(title: string, homeTeam: string, awayTeam: string): boolean {
  const t = title.toLowerCase();
  return t.includes(homeTeam.toLowerCase()) && t.includes(awayTeam.toLowerCase());
}

async function fetchPolymarket(homeTeam: string, awayTeam: string): Promise<MarketOutcome[] | null> {
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(`${homeTeam} ${awayTeam}`)}&limit_per_type=5`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const event = (data.events ?? []).find((e: { title?: string }) =>
      e.title && matchesTeams(e.title, homeTeam, awayTeam)
    );
    if (!event) return null;

    const outcomes: MarketOutcome[] = (event.markets ?? [])
      .map((m: { question?: string; outcomePrices?: string | string[] }) => {
        const raw = m.outcomePrices;
        const prices: string[] = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? []);
        const yesPrice = Number(prices[0] ?? NaN);
        if (Number.isNaN(yesPrice) || !m.question) return null;
        return { label: m.question, probability: Math.round(yesPrice * 1000) / 10 };
      })
      .filter((o: MarketOutcome | null): o is MarketOutcome => o !== null);

    return outcomes.length > 0 ? outcomes : null;
  } catch {
    return null;
  }
}

const KALSHI_SERIES_TICKER = 'KXWCGAME';

// Kalshi runs a separate series per bet type rather than one series with
// multiple markets — KXWCGAME (regulation-time moneyline, used as a silent
// confidence signal) is joined here by KXWCADVANCE (the real "does this team
// progress past this knockout tie" market — settles on the actual outcome
// including extra time/penalties, unlike every sportsbook market this app
// has) and KXWCSPREAD/KXWCTOTAL (regulation-time spread/total, usable as a
// genuine extra "book" alongside the sportsbook lines already shopped).
type KalshiSeries = 'KXWCGAME' | 'KXWCADVANCE' | 'KXWCSPREAD' | 'KXWCTOTAL';

const kalshiEventsCache = new Map<KalshiSeries, { data: { event_ticker: string; title: string }[]; expiresAt: number }>();

async function getKalshiEvents(series: KalshiSeries): Promise<{ event_ticker: string; title: string }[]> {
  const cached = kalshiEventsCache.get(series);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=${series}&status=open&limit=200`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const events = data.events ?? [];
    kalshiEventsCache.set(series, { data: events, expiresAt: Date.now() + 15 * 60 * 1000 });
    return events;
  } catch {
    return [];
  }
}

async function getKalshiEventMarkets(
  series: KalshiSeries,
  homeTeam: string,
  awayTeam: string
): Promise<{ ticker: string; title: string; yes_sub_title?: string; last_price_dollars?: string; yes_ask_dollars?: string; no_ask_dollars?: string; floor_strike?: number }[] | null> {
  try {
    const events = await getKalshiEvents(series);
    const event = events.find((e) => matchesTeams(e.title, homeTeam, awayTeam));
    if (!event) return null;

    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${event.event_ticker}`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.markets ?? null;
  } catch {
    return null;
  }
}

async function fetchKalshi(homeTeam: string, awayTeam: string): Promise<MarketOutcome[] | null> {
  const markets = await getKalshiEventMarkets(KALSHI_SERIES_TICKER, homeTeam, awayTeam);
  if (!markets) return null;

  const outcomes: MarketOutcome[] = markets
    .map((m) => {
      const price = Number(m.last_price_dollars ?? NaN);
      if (Number.isNaN(price)) return null;
      return { label: m.yes_sub_title ?? m.title ?? 'Unknown', probability: Math.round(price * 1000) / 10 };
    })
    .filter((o): o is MarketOutcome => o !== null);

  return outcomes.length > 0 ? outcomes : null;
}

// Converts a 0-1 implied probability (Kalshi prices are literally dollars on
// a $1 contract, e.g. 0.49 = 49% implied) into American odds, so Kalshi
// prices display consistently with every sportsbook price in this app.
function probToAmericanOdds(prob: number): number | null {
  if (!(prob > 0) || !(prob < 1)) return null;
  return prob >= 0.5 ? Math.round((-100 * prob) / (1 - prob)) : Math.round((100 * (1 - prob)) / prob);
}

export interface KalshiAdvanceOutcome {
  team: string;
  price: number; // American odds
  ticker: string; // Kalshi market ticker, kept so pickHistory can grade against Kalshi's own settlement later
}

// The one real market this app has for "does this team actually progress
// past this knockout tie" — settles on the true outcome including extra
// time/penalties, unlike Moneyline/Draw No Bet which both settle on
// regulation time only. Only exists for knockout-stage matches; returns
// null for group-stage games (no KXWCADVANCE event exists for them), which
// is exactly the filtering this needs — no separate stage-detection logic required.
export async function getKalshiAdvance(homeTeam: string, awayTeam: string): Promise<KalshiAdvanceOutcome[] | null> {
  const markets = await getKalshiEventMarkets('KXWCADVANCE', homeTeam, awayTeam);
  if (!markets) return null;

  const outcomes: KalshiAdvanceOutcome[] = markets
    .map((m) => {
      const prob = Number(m.yes_ask_dollars ?? m.last_price_dollars ?? NaN);
      const price = probToAmericanOdds(prob);
      const label = m.yes_sub_title ?? '';
      const team = label.includes(homeTeam) ? homeTeam : label.includes(awayTeam) ? awayTeam : null;
      if (price === null || !team) return null;
      return { team, price, ticker: m.ticker };
    })
    .filter((o): o is KalshiAdvanceOutcome => o !== null);

  return outcomes.length > 0 ? outcomes : null;
}

// Kalshi's spread/total markets are a threshold ladder ("Team wins by more
// than 1.5 goals?", "Over 1.5 goals scored?") rather than a single two-way
// line — each threshold is directly equivalent to a standard sportsbook
// spread/total at that same point value (a strict "more than X.5" settles
// identically to a sportsbook X.5 line, no push possible), so these convert
// cleanly into the same {name, price, point} shape used for sportsbook
// outcomes and can be shopped for best price alongside them.
export async function getKalshiSpread(homeTeam: string, awayTeam: string): Promise<{ name: string; price: number; point: number }[] | null> {
  const markets = await getKalshiEventMarkets('KXWCSPREAD', homeTeam, awayTeam);
  if (!markets) return null;

  const outcomes = markets
    .map((m) => {
      const floor = m.floor_strike;
      if (floor === undefined) return null;
      const prob = Number(m.yes_ask_dollars ?? m.last_price_dollars ?? NaN);
      const price = probToAmericanOdds(prob);
      const title = m.title ?? '';
      const team = title.includes(homeTeam) ? homeTeam : title.includes(awayTeam) ? awayTeam : null;
      if (price === null || !team) return null;
      return { name: team, price, point: -floor };
    })
    .filter((o): o is { name: string; price: number; point: number } => o !== null);

  return outcomes.length > 0 ? outcomes : null;
}

export async function getKalshiTotal(homeTeam: string, awayTeam: string): Promise<{ name: string; price: number; point: number }[] | null> {
  const markets = await getKalshiEventMarkets('KXWCTOTAL', homeTeam, awayTeam);
  if (!markets) return null;

  const outcomes: { name: string; price: number; point: number }[] = [];
  for (const m of markets) {
    const floor = m.floor_strike;
    if (floor === undefined) continue;
    const overProb = Number(m.yes_ask_dollars ?? m.last_price_dollars ?? NaN);
    const overPrice = probToAmericanOdds(overProb);
    if (overPrice !== null) outcomes.push({ name: 'Over', price: overPrice, point: floor });
    const underProb = Number(m.no_ask_dollars ?? NaN);
    const underPrice = probToAmericanOdds(underProb);
    if (underPrice !== null) outcomes.push({ name: 'Under', price: underPrice, point: floor });
  }

  return outcomes.length > 0 ? outcomes : null;
}

// Kalshi's regulation-time moneyline (KXWCGAME) as a real shoppable "book"
// for the Moneyline/Tie market — same three outcomes (home/away/Tie) a
// sportsbook quotes, so it slots directly alongside them in getBestLine.
export async function getKalshiMoneyline(homeTeam: string, awayTeam: string): Promise<{ name: string; price: number }[] | null> {
  const markets = await getKalshiEventMarkets('KXWCGAME', homeTeam, awayTeam);
  if (!markets) return null;

  const outcomes: { name: string; price: number }[] = [];
  for (const m of markets) {
    const prob = Number(m.yes_ask_dollars ?? m.last_price_dollars ?? NaN);
    const price = probToAmericanOdds(prob);
    if (price === null) continue;
    const label = m.yes_sub_title ?? '';
    const name = label.includes(homeTeam) ? homeTeam : label.includes(awayTeam) ? awayTeam : label.toLowerCase().includes('tie') ? 'Tie' : null;
    if (!name) continue;
    outcomes.push({ name, price });
  }

  return outcomes.length > 0 ? outcomes : null;
}

// Looks up a single Kalshi market by ticker to check its real settlement —
// used to grade "To Advance" picks against Kalshi's own resolution (which
// team actually progressed, including extra time/penalties) instead of
// trying to infer it from a regulation-time score that can't tell us that.
export async function getKalshiMarketResult(ticker: string): Promise<'yes' | 'no' | null> {
  try {
    const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const market = data.market;
    if (!market || market.status !== 'finalized') return null;
    return market.result === 'yes' ? 'yes' : market.result === 'no' ? 'no' : null;
  } catch {
    return null;
  }
}

export async function getPredictionMarkets(
  homeTeam: string,
  awayTeam: string
): Promise<MatchPredictionMarkets> {
  const [polymarket, kalshi] = await Promise.all([
    fetchPolymarket(homeTeam, awayTeam),
    fetchKalshi(homeTeam, awayTeam),
  ]);
  return { polymarket, kalshi };
}

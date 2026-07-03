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

const kalshiEventsCache = new Map<string, { data: { event_ticker: string; title: string }[]; expiresAt: number }>();

async function getKalshiEvents(seriesTicker: string): Promise<{ event_ticker: string; title: string }[]> {
  const cached = kalshiEventsCache.get(seriesTicker);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=${seriesTicker}&status=open&limit=200`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const events = data.events ?? [];
    kalshiEventsCache.set(seriesTicker, { data: events, expiresAt: Date.now() + 15 * 60 * 1000 });
    return events;
  } catch {
    return [];
  }
}

async function fetchKalshi(homeTeam: string, awayTeam: string, seriesTicker: string): Promise<MarketOutcome[] | null> {
  try {
    const events = await getKalshiEvents(seriesTicker);
    const event = events.find((e) => matchesTeams(e.title, homeTeam, awayTeam));
    if (!event) return null;

    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${event.event_ticker}`,
      { next: { revalidate: 900 } }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const outcomes: MarketOutcome[] = (data.markets ?? [])
      .map((m: { yes_sub_title?: string; title?: string; last_price_dollars?: string }) => {
        const price = Number(m.last_price_dollars ?? NaN);
        if (Number.isNaN(price)) return null;
        return { label: m.yes_sub_title ?? m.title ?? 'Unknown', probability: Math.round(price * 1000) / 10 };
      })
      .filter((o: MarketOutcome | null): o is MarketOutcome => o !== null);

    return outcomes.length > 0 ? outcomes : null;
  } catch {
    return null;
  }
}

export async function getPredictionMarkets(
  homeTeam: string,
  awayTeam: string,
  kalshiSeriesTicker: string = 'KXWCGAME'
): Promise<MatchPredictionMarkets> {
  const [polymarket, kalshi] = await Promise.all([
    fetchPolymarket(homeTeam, awayTeam),
    fetchKalshi(homeTeam, awayTeam, kalshiSeriesTicker),
  ]);
  return { polymarket, kalshi };
}

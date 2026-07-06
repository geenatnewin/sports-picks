import { NextResponse } from 'next/server';
import { getWorldCupOdds, getBestLine, getLineDivergence, formatAmericanOdds, normalizeOutcomeName } from '@/lib/odds';
import { getMatchRecentForm } from '@/lib/soccer';
import { getKalshiAdvance } from '@/lib/predictionMarkets';

// Game lines/props only — no player props here (those live in the separate
// Player Props tab, fed by PropLine). h2h/spreads/totals now shop Kalshi
// alongside sportsbooks (see injectKalshiBookmaker in lib/odds.ts); draw_no_bet
// is sportsbook-only (The Odds API already carries it). "To Advance" isn't in
// this table since it comes from a separate Kalshi-only lookup below, not
// the shopped-bookmakers list — it only exists for knockout-stage matches.
const MARKET_LABELS: Record<string, string> = {
  h2h: 'Moneyline',
  spreads: 'Spread',
  totals: 'Total Goals',
  draw_no_bet: 'Draw No Bet',
};

function outcomeLabel(marketKey: string, name: string, point?: number): string {
  const label = normalizeOutcomeName(name);
  if (marketKey === 'spreads' && point !== undefined) {
    return `${label} ${point > 0 ? '+' : ''}${point}`;
  }
  if (marketKey === 'totals' && point !== undefined) {
    return `${label} ${point}`;
  }
  return label;
}

export async function GET() {
  const games = await getWorldCupOdds();

  const matches = await Promise.all(
    games.map(async (game) => {
      const markets = Object.keys(MARKET_LABELS)
        .map((marketKey) => {
          const outcomes = getBestLine(game, marketKey);
          if (!outcomes) return null;
          return {
            key: marketKey,
            label: MARKET_LABELS[marketKey],
            outcomes: outcomes.map((o) => ({
              id: `${game.id}-${marketKey}-${o.name}-${o.point ?? ''}`,
              label: outcomeLabel(marketKey, o.name, o.point),
              odds: formatAmericanOdds(o.price),
              oddsValue: o.price,
            })),
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      // Knockout-stage only (no KXWCADVANCE event exists for group-stage
      // games, which is exactly the filter this needs) — the one real
      // market that settles on the full match including extra time/penalties.
      const advance = await getKalshiAdvance(game.home_team, game.away_team).catch(() => null);
      if (advance) {
        markets.push({
          key: 'to_advance',
          label: 'To Advance',
          outcomes: advance.map((o) => ({
            id: `${game.id}-to_advance-${o.team}`,
            label: o.team,
            odds: formatAmericanOdds(o.price),
            oddsValue: o.price,
            // Threaded through so a manually-placed "To Advance" slip leg can
            // be graded against Kalshi's own settlement later (see
            // slipHistory.ts) — the event's odds may no longer be queryable
            // by team name once the market closes, so this needs capturing now.
            kalshiTicker: o.ticker,
          })),
        });
      }

      const { homeForm, awayForm } = await getMatchRecentForm(game.home_team, game.away_team).catch(() => ({
        homeForm: null,
        awayForm: null,
      }));

      return {
        gameId: game.id,
        event: `${game.home_team} vs ${game.away_team}`,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        homeForm,
        awayForm,
        isLive: new Date(game.commence_time) < new Date(),
        lineDivergence: getLineDivergence(game, 'h2h'),
        matchTime: new Date(game.commence_time).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
        markets,
      };
    })
  );

  return NextResponse.json({ matches });
}

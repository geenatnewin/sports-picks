import { NextResponse } from 'next/server';
import { getWorldCupOdds, getBestLine, formatAmericanOdds } from '@/lib/odds';

const MARKET_LABELS: Record<string, string> = {
  h2h: 'Moneyline',
  spreads: 'Spread',
  totals: 'Total Goals',
};

function outcomeLabel(marketKey: string, name: string, point?: number): string {
  if (marketKey === 'spreads' && point !== undefined) {
    return `${name} ${point > 0 ? '+' : ''}${point}`;
  }
  if (marketKey === 'totals' && point !== undefined) {
    return `${name} ${point}`;
  }
  return name;
}

export async function GET() {
  const games = await getWorldCupOdds();

  const matches = games.map((game) => {
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

    return {
      gameId: game.id,
      event: `${game.home_team} vs ${game.away_team}`,
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
  });

  return NextResponse.json({ matches });
}

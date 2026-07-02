import { NextResponse } from 'next/server';
import { getWorldCupOdds, getBestLine, formatAmericanOdds, normalizeOutcomeName } from '@/lib/odds';
import { getMatchRecentForm } from '@/lib/soccer';

const MARKET_LABELS: Record<string, string> = {
  h2h: 'Moneyline',
  spreads: 'Spread',
  totals: 'Total Goals',
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

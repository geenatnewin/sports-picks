import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getWorldCupOdds, getGolfOdds, getBestLine, formatAmericanOdds } from '@/lib/odds';
import { getWorldCupStandings } from '@/lib/soccer';
import { getTournamentPredictions, getGolfRankings } from '@/lib/golf';
import { getPredictionMarkets } from '@/lib/predictionMarkets';
import { PicksResponse } from '@/lib/types';

// Cache the generated picks for 20 minutes — repeated Refresh presses or page
// reloads within this window reuse the cached result instead of paying for a
// new Anthropic call each time. In-memory so it also works in `next dev`.
const CACHE_TTL_MS = 20 * 60 * 1000;
let cache: { data: PicksResponse; expiresAt: number } | null = null;

interface StandingsRow {
  team: { name: string; shortName?: string };
  position: number;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

function findTeamStats(rows: StandingsRow[], teamName: string): string | null {
  const needle = teamName.toLowerCase();
  const row = rows.find(
    (r) => r.team.name.toLowerCase() === needle || r.team.shortName?.toLowerCase() === needle
  );
  if (!row) return null;
  return `${row.playedGames}P ${row.won}W-${row.draw}D-${row.lost}L, ${row.goalsFor}-${row.goalsAgainst} GF-GA, ${row.points}pts (group position ${row.position})`;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Golf is switched off for now — set to true to bring it back.
const INCLUDE_GOLF = false;

// Preview mode — shows real matches/odds with fabricated picks, no AI call needed.
// Set to false once a real ANTHROPIC_API_KEY is active.
const MOCK_PICKS = true;

function buildMockWorldCup(data: { homeTeam: string; awayTeam: string; kickoff: string; mlRaw: { name: string; price: number }[] }[]) {
  return data.map((g) => {
    const sorted = [...g.mlRaw].sort((a, b) => a.price - b.price); // most negative (favorite) first
    const favorite = sorted[0];

    return {
      event: `${g.homeTeam} vs ${g.awayTeam}`,
      matchTime: g.kickoff,
      highestPercent: {
        pick: favorite ? favorite.name : g.homeTeam,
        betType: 'Moneyline',
        odds: favorite ? formatAmericanOdds(favorite.price) : 'N/A',
        confidence: 'High' as const,
        explanation: `[Preview] Placeholder pick using real odds — not real analysis yet. Add a real ANTHROPIC_API_KEY to get actual reasoning here.`,
      },
    };
  });
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data);
  }

  const errors: string[] = [];

  // Fetch all data in parallel
  const [wcOdds, wcStandings, golfOdds, golfPreds, golfRankings] = await Promise.all([
    getWorldCupOdds().catch(() => { errors.push('World Cup odds unavailable'); return []; }),
    getWorldCupStandings().catch(() => { errors.push('World Cup standings unavailable'); return null; }),
    INCLUDE_GOLF ? getGolfOdds().catch(() => { errors.push('Golf odds unavailable'); return null; }) : Promise.resolve(null),
    INCLUDE_GOLF ? getTournamentPredictions().catch(() => { errors.push('Golf predictions unavailable'); return null; }) : Promise.resolve(null),
    INCLUDE_GOLF ? getGolfRankings().catch(() => { errors.push('Golf rankings unavailable'); return null; }) : Promise.resolve(null),
  ]);

  // Flatten group standings into one lookup table
  const standingsRows: StandingsRow[] = (wcStandings?.standings ?? []).flatMap(
    (s: { table: StandingsRow[] }) => s.table ?? []
  );

  // Format World Cup data for AI — includes today's matches plus upcoming ones
  const wcData = await Promise.all(
    wcOdds.slice(0, 6).map(async (game) => {
      const ml = getBestLine(game, 'h2h');
      const spread = getBestLine(game, 'spreads');
      const totals = getBestLine(game, 'totals');
      const markets = await getPredictionMarkets(game.home_team, game.away_team).catch(() => ({
        polymarket: null,
        kalshi: null,
      }));

      const formatMarket = (outcomes: { label: string; probability: number }[] | null) =>
        outcomes ? outcomes.map((o) => `${o.label}: ${o.probability}%`).join(' | ') : null;

      return {
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        kickoff: new Date(game.commence_time).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
        mlRaw: ml ?? [],
        moneyline: ml
          ? ml.map((o) => `${o.name}: ${formatAmericanOdds(o.price)}`).join(' | ')
          : 'Not available',
        spread: spread
          ? spread.map((o) => `${o.name} ${o.point && o.point > 0 ? '+' : ''}${o.point ?? ''}: ${formatAmericanOdds(o.price)}`).join(' | ')
          : 'Not available',
        totals: totals
          ? totals.map((o) => `${o.name} ${o.point ?? ''}: ${formatAmericanOdds(o.price)}`).join(' | ')
          : 'Not available',
        homeStats: findTeamStats(standingsRows, game.home_team) ?? 'No group-stage record yet',
        awayStats: findTeamStats(standingsRows, game.away_team) ?? 'No group-stage record yet',
        polymarket: formatMarket(markets.polymarket),
        kalshi: formatMarket(markets.kalshi),
      };
    })
  );

  // Format golf data for AI
  const golfData = golfOdds
    ? {
        tournament: golfOdds.tournament.replace(/_/g, ' ').toUpperCase(),
        topOdds: golfOdds.games[0]?.bookmakers[0]?.markets[0]?.outcomes
          .sort((a, b) => a.price - b.price)
          .slice(0, 20)
          .map((o) => `${o.name}: ${formatAmericanOdds(o.price)}`) ?? [],
        dgPredictions: golfPreds?.baseline_history_fit?.slice(0, 10).map((p: Record<string, unknown>) =>
          `${p.player_name}: Win% ${((p.win_prob as number) * 100).toFixed(1)}%`
        ) ?? [],
        rankings: golfRankings?.rankings?.slice(0, 10).map((r: Record<string, unknown>) =>
          `${r.player_name} (DG rank: ${r.dg_rank})`
        ) ?? [],
      }
    : null;

  const hasWCData = wcData.length > 0;
  const hasGolfData = golfData !== null;

  if (!hasWCData && !hasGolfData) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ worldcup: [], golf: [], generatedAt: new Date().toISOString(), errors: ['API keys not configured yet. See HANDOFF.md for setup instructions.'] });
    }
  }

  if (MOCK_PICKS) {
    const mockResponse: PicksResponse = {
      worldcup: buildMockWorldCup(wcData),
      golf: [],
      generatedAt: new Date().toISOString(),
      errors,
    };
    cache = { data: mockResponse, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(mockResponse);
  }

  // Build AI prompt
  const prompt = `You are a professional sports handicapper. For EVERY match listed below, produce ONE pick: "highestPercent" — whichever outcome has the HIGHEST PROBABILITY OF ACTUALLY WINNING, full stop. Odds/payout size is not a factor here — a -400 favorite you're confident in beats a +200 underdog you're not. This is often the favorite, but only pick it if the data actually supports it.

Use everything provided below to determine the pick and your confidence level: the odds from the sportsbooks listed, Kalshi and Polymarket prediction market prices (these reflect real money betting on the actual outcome and are often sharper than sportsbook odds — weigh them heavily when estimating true win probability, especially when they disagree with the sportsbook implied probability), each team's group-stage record (record, goal difference, points), and your own general knowledge of these national teams — squad quality, key players, typical tactical approach, and anything you know about current injuries or squad news.

IMPORTANT: Do NOT mention, cite, or name-drop "Kalshi", "Polymarket", "prediction markets", or their specific prices anywhere in the explanation text. Use that data silently to inform your pick and confidence — the explanation should read as your own analysis, sourced from odds, stats, and football knowledge only. If you're relying on general knowledge rather than the sportsbook/stats data provided (e.g. injury news), say so plainly rather than stating it as verified fact — you do not have a live injury feed.

The explanation is shown in a dedicated detail view. Format it as 3-4 short bullet points, NOT one long paragraph — each bullet starts with "• " on its own line (use a real newline character between bullets). Keep the whole thing tight, roughly 60-90 words total across all bullets combined, but still information-dense — every bullet should carry a real, specific fact, not filler. Cover whichever of these are most relevant to the pick (you don't need all of them every time): what the sportsbook odds imply and whether that's justified; the key form/stats angle (group-stage record, goal difference); the tactical or squad-quality factor; a key player, injury, or squad note (clearly flagged as general knowledge, not live data, if relevant); historical context between these teams if it matters. Write each bullet as a punchy, specific claim — no throat-clearing, no restating the obvious.

${hasWCData ? `
=== WORLD CUP 2026 — UPCOMING MATCHES ===
${wcData.map((g, i) => `
Match ${i + 1}: ${g.homeTeam} vs ${g.awayTeam}
Kickoff (ET): ${g.kickoff}
Moneyline: ${g.moneyline}
Spread: ${g.spread}
Totals: ${g.totals}
Polymarket: ${g.polymarket ?? 'Not available'}
Kalshi: ${g.kalshi ?? 'Not available'}
${g.homeTeam} group-stage record: ${g.homeStats}
${g.awayTeam} group-stage record: ${g.awayStats}
`).join('\n')}
` : 'No upcoming World Cup matches with posted odds right now.'}

${hasGolfData ? `
=== ${golfData!.tournament} ===
Top Odds (Winner Market):
${golfData!.topOdds.join('\n')}

DataGolf Win Probabilities:
${golfData!.dgPredictions.join('\n')}

World Rankings:
${golfData!.rankings.join('\n')}
` : 'No golf tournament data available.'}

Return a JSON object with this exact structure:
{
  "worldcup": [
    {
      "event": "Team A vs Team B",
      "matchTime": "Fri, Jul 3 · 3:00 PM ET",
      "highestPercent": {
        "pick": "Team A -0.5",
        "betType": "Spread",
        "odds": "+110",
        "confidence": "High",
        "explanation": "• Bullet one: a specific fact (e.g. odds/implied probability)\n• Bullet two: another specific fact (e.g. form or stats)\n• Bullet three: tactical, injury, or historical note if relevant"
      }
    }
  ],
  "golf": [
    {
      "event": "Tournament Name",
      "pick": "Player Name",
      "betType": "Tournament Winner",
      "odds": "+350",
      "confidence": "Medium",
      "explanation": "2-3 sentences on why this player has the best realistic chance to win this field"
    }
  ]
}

Rules:
- Every match listed must get exactly one "highestPercent" entry — do not skip any match.
- Consider all matches listed above, whether they're today or several days out — do not limit yourself to only today's games.
- Include the match date in "matchTime" (e.g. "Fri, Jul 3 · 3:00 PM ET") so it's clear which day each pick is for.
- Max 3 golf picks
- Confidence: High = very likely to win, Medium = probably wins but real risk exists, Low = leaning this way but genuinely uncertain
- If no upcoming World Cup matches are listed, return an empty array
- Always return valid JSON only, no other text`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    // Sonnet 5 uses adaptive thinking by default, so the text block isn't
    // necessarily content[0] — a thinking block can come first.
    const textBlock = message.content.find((block) => block.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    const picks = JSON.parse(jsonMatch[0]);

    const response: PicksResponse = {
      worldcup: picks.worldcup ?? [],
      golf: picks.golf ?? [],
      generatedAt: new Date().toISOString(),
      errors,
    };

    cache = { data: response, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(response);
  } catch (err) {
    errors.push(`AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return NextResponse.json({ worldcup: [], golf: [], generatedAt: new Date().toISOString(), errors });
  }
}

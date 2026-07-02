import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getWorldCupOdds, getGolfOdds, getBestLine, formatAmericanOdds } from '@/lib/odds';
import { getWorldCupMatches } from '@/lib/soccer';
import { getTournamentPredictions, getGolfRankings } from '@/lib/golf';
import { PicksResponse } from '@/lib/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET() {
  const errors: string[] = [];

  // Fetch all data in parallel
  const [wcOdds, wcMatches, golfOdds, golfPreds, golfRankings] = await Promise.all([
    getWorldCupOdds().catch(() => { errors.push('World Cup odds unavailable'); return []; }),
    getWorldCupMatches().catch(() => { errors.push('World Cup match data unavailable'); return null; }),
    getGolfOdds().catch(() => { errors.push('Golf odds unavailable'); return null; }),
    getTournamentPredictions().catch(() => { errors.push('Golf predictions unavailable'); return null; }),
    getGolfRankings().catch(() => { errors.push('Golf rankings unavailable'); return null; }),
  ]);

  // Format World Cup data for AI
  const wcData = wcOdds.slice(0, 6).map((game) => {
    const ml = getBestLine(game, 'h2h');
    const spread = getBestLine(game, 'spreads');
    return {
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      kickoff: new Date(game.commence_time).toLocaleString('en-US', { timeZone: 'America/New_York' }),
      moneyline: ml
        ? ml.map((o) => `${o.name}: ${formatAmericanOdds(o.price)}`).join(' | ')
        : 'Not available',
      spread: spread
        ? spread.map((o) => `${o.name} ${o.point && o.point > 0 ? '+' : ''}${o.point ?? ''}: ${formatAmericanOdds(o.price)}`).join(' | ')
        : 'Not available',
    };
  });

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

  // Build AI prompt
  const prompt = `You are a sharp sports betting analyst. Your goal is to find the picks with the HIGHEST PROBABILITY OF ACTUALLY WINNING today — not the best payout, not the best "value" relative to the odds. If a heavy favorite is the safest, most likely winner, pick it. Do not prefer an underdog or a longer-odds play just because the payout is bigger — only pick it if the data genuinely supports it being more likely to win than the market suggests.

${hasWCData ? `
=== WORLD CUP 2026 MATCHES (TODAY) ===
${wcData.map((g, i) => `
Match ${i + 1}: ${g.homeTeam} vs ${g.awayTeam}
Kickoff (ET): ${g.kickoff}
Moneyline: ${g.moneyline}
Spread: ${g.spread}
`).join('\n')}
` : 'No World Cup matches available today.'}

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
      "pick": "Team A -0.5",
      "betType": "Spread",
      "odds": "+110",
      "confidence": "High",
      "explanation": "2-3 sentences explaining why this team/side is the most likely winner, using form, stats, and matchup context",
      "matchTime": "3:00 PM ET"
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
- Rank and select picks by estimated win probability first. Odds/payout size is not a deciding factor — a -400 favorite you're confident in is a better pick than a +200 underdog you're not.
- Max 4 World Cup picks (only today's games), max 3 golf picks
- Confidence: High = very likely to win, Medium = probably wins but real risk exists, Low = leaning this way but genuinely uncertain
- If no World Cup games today, return empty array
- Always return valid JSON only, no other text`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    const picks = JSON.parse(jsonMatch[0]);

    const response: PicksResponse = {
      worldcup: picks.worldcup ?? [],
      golf: picks.golf ?? [],
      generatedAt: new Date().toISOString(),
      errors,
    };

    return NextResponse.json(response);
  } catch (err) {
    errors.push(`AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return NextResponse.json({ worldcup: [], golf: [], generatedAt: new Date().toISOString(), errors });
  }
}

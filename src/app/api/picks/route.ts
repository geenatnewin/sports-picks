import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import Anthropic from '@anthropic-ai/sdk';
import { getWorldCupOdds, getBestLine, getLineDivergence, getFinishedScores, formatAmericanOdds, normalizeOutcomeName } from '@/lib/odds';
import { getWorldCupStandings, getTeamRecentForm, summarizeRecentForm } from '@/lib/soccer';
import { getPredictionMarkets } from '@/lib/predictionMarkets';
import { gradeAndSummarize, recordPicks } from '@/lib/pickHistory';
import { recordSnapshotsAndDescribeMovement } from '@/lib/oddsHistory';
import { PicksResponse } from '@/lib/types';

// Cache the generated picks for 20 minutes — repeated Refresh presses or page
// reloads within this window reuse the cached result instead of paying for a
// new Anthropic call each time. Uses Next's persistent Data Cache (not a
// plain in-memory variable) because Vercel can route requests to different
// serverless instances — an in-memory cache would reset on every cold start
// and silently fail to prevent repeat billed calls.
const CACHE_TTL_SECONDS = 20 * 60;

interface StandingsRow {
  team: { id: number; name: string; shortName?: string };
  position: number;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

function findTeamRow(rows: StandingsRow[], teamName: string): StandingsRow | null {
  const needle = teamName.toLowerCase();
  return (
    rows.find((r) => r.team.name.toLowerCase() === needle || r.team.shortName?.toLowerCase() === needle) ?? null
  );
}

function findTeamStats(rows: StandingsRow[], teamName: string): string | null {
  const row = findTeamRow(rows, teamName);
  if (!row) return null;
  return `${row.playedGames}P ${row.won}W-${row.draw}D-${row.lost}L, ${row.goalsFor}-${row.goalsAgainst} GF-GA, ${row.points}pts (group position ${row.position})`;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Escapes raw control characters (literal newlines, tabs, etc.) that appear
// inside JSON string literals — the model is asked to use \n instead, but
// this is a safety net in case it doesn't comply, since a single stray raw
// newline makes the entire response fail JSON.parse.
function sanitizeJsonText(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        result += ch;
        escaped = false;
      } else if (ch === '\\') {
        result += ch;
        escaped = true;
      } else if (ch === '"') {
        result += ch;
        inString = false;
      } else if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else if (ch === '\t') {
        result += '\\t';
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }
  return result;
}

// Preview mode — shows real matches/odds with fabricated picks, no AI call needed.
// Set to false once a real ANTHROPIC_API_KEY is active.
const MOCK_PICKS = false;

function buildMockWorldCup(data: { homeTeam: string; awayTeam: string; kickoff: string; mlRaw: { name: string; price: number }[] }[]) {
  return data.map((g) => {
    const sorted = [...g.mlRaw].sort((a, b) => a.price - b.price); // most negative (favorite) first
    const favorite = sorted[0];

    return {
      event: `${g.homeTeam} vs ${g.awayTeam}`,
      matchTime: g.kickoff,
      highestPercent: {
        pick: favorite ? normalizeOutcomeName(favorite.name) : g.homeTeam,
        betType: 'Moneyline',
        odds: favorite ? formatAmericanOdds(favorite.price) : 'N/A',
        confidence: 'High' as const,
        explanation: `[Preview] Placeholder pick using real odds — not real analysis yet. Add a real ANTHROPIC_API_KEY to get actual reasoning here.`,
        timing: '[Preview] Placeholder — not real timing analysis yet.',
      },
    };
  });
}

async function generatePicks(): Promise<PicksResponse> {
  const errors: string[] = [];

  // Fetch all data in parallel
  const [wcOdds, wcStandings, finishedScores] = await Promise.all([
    getWorldCupOdds().catch(() => { errors.push('World Cup odds unavailable'); return []; }),
    getWorldCupStandings().catch(() => { errors.push('World Cup standings unavailable'); return null; }),
    getFinishedScores().catch(() => []),
  ]);

  // Grade any previously-recorded picks whose matches have since finished
  // against real final scores, so the AI can see how its own past picks
  // have performed. New picks from this run are recorded further below,
  // once the AI response is available.
  const { history: pickHistory, summary: trackRecord } = await gradeAndSummarize(finishedScores);

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
      const lineDivergence = getLineDivergence(game, 'h2h');
      const markets = await getPredictionMarkets(game.home_team, game.away_team).catch(() => ({
        polymarket: null,
        kalshi: null,
      }));

      const homeRow = findTeamRow(standingsRows, game.home_team);
      const awayRow = findTeamRow(standingsRows, game.away_team);
      const [homeFormData, awayFormData] = await Promise.all([
        homeRow ? getTeamRecentForm(homeRow.team.id).catch(() => null) : Promise.resolve(null),
        awayRow ? getTeamRecentForm(awayRow.team.id).catch(() => null) : Promise.resolve(null),
      ]);
      const homeForm = homeRow ? summarizeRecentForm(homeFormData, homeRow.team.id) : null;
      const awayForm = awayRow ? summarizeRecentForm(awayFormData, awayRow.team.id) : null;

      const formatMarket = (outcomes: { label: string; probability: number }[] | null) =>
        outcomes ? outcomes.map((o) => `${o.label}: ${o.probability}%`).join(' | ') : null;

      return {
        gameId: game.id,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        kickoffISO: game.commence_time,
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
          ? ml.map((o) => `${normalizeOutcomeName(o.name)}: ${formatAmericanOdds(o.price)}`).join(' | ')
          : 'Not available',
        spread: spread
          ? spread.map((o) => `${o.name} ${o.point && o.point > 0 ? '+' : ''}${o.point ?? ''}: ${formatAmericanOdds(o.price)}`).join(' | ')
          : 'Not available',
        totals: totals
          ? totals.map((o) => `${o.name} ${o.point ?? ''}: ${formatAmericanOdds(o.price)}`).join(' | ')
          : 'Not available',
        homeStats: findTeamStats(standingsRows, game.home_team) ?? 'No group-stage record yet',
        awayStats: findTeamStats(standingsRows, game.away_team) ?? 'No group-stage record yet',
        homeForm: homeForm ?? 'No recent match history',
        awayForm: awayForm ?? 'No recent match history',
        polymarket: formatMarket(markets.polymarket),
        kalshi: formatMarket(markets.kalshi),
        lineDivergence,
      };
    })
  );

  // Snapshot current moneyline prices for each match (for future "line
  // movement" comparisons) and get back a plain-language description of how
  // each outcome's price has moved so far, to feed into the prompt as a
  // timing signal.
  const movementByGame = await recordSnapshotsAndDescribeMovement(
    wcData.map((g) => ({
      gameId: g.gameId,
      kickoffISO: g.kickoffISO,
      h2h: g.mlRaw.map((o) => ({ name: normalizeOutcomeName(o.name), price: o.price })),
    }))
  );

  const hasWCData = wcData.length > 0;

  if (!hasWCData && !process.env.ANTHROPIC_API_KEY) {
    return { worldcup: [], generatedAt: new Date().toISOString(), errors: ['API keys not configured yet. See HANDOFF.md for setup instructions.'] };
  }

  if (MOCK_PICKS) {
    return {
      worldcup: buildMockWorldCup(wcData),
      generatedAt: new Date().toISOString(),
      errors,
    };
  }

  // Build AI prompt
  const prompt = `You are a professional sports handicapper. For EVERY match listed below, produce ONE pick: "highestPercent" — whichever outcome has the HIGHEST PROBABILITY OF ACTUALLY WINNING, full stop. Odds/payout size is not a factor here — a -400 favorite you're confident in beats a +200 underdog you're not. This is often the favorite, but only pick it if the data actually supports it.

Use everything provided below to determine the pick and your confidence level: the odds from the sportsbooks listed, Kalshi and Polymarket prediction market prices (these reflect real money betting on the actual outcome and are often sharper than sportsbook odds — weigh them heavily when estimating true win probability, especially when they disagree with the sportsbook implied probability), each team's group-stage record (record, goal difference, points), each team's actual last 5 match results (a stronger "how are they playing right now" signal than the aggregate record — weight recent form heavily, especially if it diverges from the season-long record), and your own general knowledge of these national teams. That general knowledge should actively cover, wherever relevant: overall squad quality and depth; individual player tendencies and strengths (e.g. a team's top scorer's finishing quality, a key playmaker's creativity and passing range, a goalkeeper's shot-stopping reputation, a defender prone to mistakes); each team's typical tactical strategy and style of play (possession-based vs. counter-attacking, high press vs. low block, set-piece threat, defensive solidity, how they set up against stronger vs. weaker opponents); historical head-to-head results or tournament history between these two teams if it's notable; and anything you know about current injuries or squad news. Don't limit your reasoning to just the numeric stats provided — actively factor in this tactical and player-level knowledge, not just as a passing mention.

IMPORTANT: Do not treat two teams' records as equivalent just because the win/loss/goal numbers look similar — weigh the QUALITY of the opponents that produced those results, and each team's overall strength as a squad (talent level, star players, depth, typical tactical level versus the other major national teams). A loss to a top-tier team (e.g. Argentina, France, Brazil, England — elite squads by current form and player quality) is a very different signal than a loss to a weak team, even if the scoreline or record looks comparable. Use this reasoning transitively: if Team A lost a close, competitive match to a top-tier team, and Team B beat a weak team, Team A is likely still the stronger side and should usually be favored over Team B, even with a similar W-D-L record. Bake this strength-of-schedule and squad-quality judgment into both the pick and the confidence level, not just the raw stats.

IMPORTANT: Refer to a tied-match outcome as "Tie", never "Draw", in both the pick and the explanation.

IMPORTANT: Some matches include a "Line divergence" note — how widely sportsbooks disagree with each other on the same outcome's implied win probability. This is a soft market-uncertainty signal only, not a real fixing-detection tool (that requires account-level betting data no public odds API provides). It does NOT indicate which side is more likely to win. Never claim, imply, or speculate that a match is fixed, manipulated, or rigged. When a match is flagged, the only appropriate uses are: (1) treat it as a reason to be more conservative — e.g. drop confidence from High to Medium — and (2) optionally add one brief, neutrally-worded bullet like "sportsbooks disagree more than usual on this line" if genuinely relevant. Do not speculate about why.

IMPORTANT: Do NOT mention, cite, or name-drop "Kalshi", "Polymarket", "prediction markets", or their specific prices anywhere in the explanation text. Use that data silently to inform your pick and confidence — the explanation should read as your own analysis, sourced from odds, stats, and football knowledge only. If you're relying on general knowledge rather than the sportsbook/stats data provided (e.g. injury news), say so plainly rather than stating it as verified fact — you do not have a live injury feed.
${trackRecord.promptText ? `
IMPORTANT: Here is your own track record on past picks, graded against actual results: ${trackRecord.promptText} Use this only as a light calibration signal — if a market type has been underperforming, lean a little more conservative (e.g. High → Medium) there specifically, and vice versa if it's been hitting well. This is a small sample, so don't let it override what the actual data for a given match tells you, and never mention this track record in the explanation text.
` : ''}

IMPORTANT: Each pick also needs a "timing" field — one short sentence (roughly 12-20 words) advising whether to place this bet now or wait, based on the "Moneyline price history" shown for that match. If the price for your picked outcome has been shortening (moving toward less profitable, e.g. -110 → -140, or +150 → +110), say betting now is better since it's likely to keep shortening. If it's been drifting the other way (lengthening, e.g. -140 → -110, or +110 → +180), say it may be worth waiting a bit, since it could keep drifting in the bettor's favor — but note this isn't guaranteed. If there's not enough history yet to see a real trend (the note says "just started tracking" or has only 1-2 data points), say plainly that there isn't enough data yet and betting now vs. waiting doesn't have a clear edge either way. Only reason from the actual price history given — do not invent a trend that isn't shown, and do not confuse this with the "Line divergence" signal, which is a different, unrelated thing.

The explanation is shown in a dedicated detail view. Format it as 3-4 short bullet points, NOT one long paragraph — each bullet starts with "• ". Since this whole response must be valid JSON, separate bullets using the two-character escape sequence \n (backslash followed by the letter n) inside the JSON string — do NOT insert a raw/literal line break. Keep the whole thing tight, roughly 60-90 words total across all bullets combined, but still information-dense — every bullet should carry a real, specific fact, not filler. Cover whichever of these are most relevant to the pick (you don't need all of them every time): what the sportsbook odds imply and whether that's justified; the key form/stats angle (group-stage record, goal difference); a specific tactical/style-of-play matchup detail (pressing, possession, set pieces, how one team's approach exploits the other's weakness); a specific player tendency or player-level detail (a key scorer, playmaker, or defensive liability by name, clearly flagged as general knowledge, not live data); an injury or squad note if relevant (same caveat); historical head-to-head context if it matters. Prefer specific, named details (a player, a tactical trait, a stat) over generic statements like "has a strong squad." Write each bullet as a punchy, specific claim — no throat-clearing, no restating the obvious.

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
${g.homeTeam} last 5 results: ${g.homeForm}
${g.awayTeam} last 5 results: ${g.awayForm}
Moneyline price history (oldest to newest, since this app started tracking it — NOT the full pre-game market history): ${movementByGame.get(g.gameId)}
${g.lineDivergence.flagged ? `Line divergence: FLAGGED — sportsbooks disagree by ~${g.lineDivergence.maxSpreadPct} points on ${g.lineDivergence.outcome}'s implied probability` : ''}
`).join('\n')}
` : 'No upcoming World Cup matches with posted odds right now.'}

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
        "explanation": "• Bullet one: a specific fact (e.g. odds/implied probability)\n• Bullet two: another specific fact (e.g. form or stats)\n• Bullet three: tactical, injury, or historical note if relevant",
        "timing": "One short sentence on whether to bet now or wait, based on the price history for this match."
      }
    }
  ]
}

Rules:
- Every match listed must get exactly one "highestPercent" entry — do not skip any match.
- Consider all matches listed above, whether they're today or several days out — do not limit yourself to only today's games.
- Include the match date in "matchTime" (e.g. "Fri, Jul 3 · 3:00 PM ET") so it's clear which day each pick is for.
- Confidence: High = very likely to win, Medium = probably wins but real risk exists, Low = leaning this way but genuinely uncertain
- If no upcoming World Cup matches are listed, return an empty array
- Always return valid JSON only, no other text`;

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

  const picks = JSON.parse(sanitizeJsonText(jsonMatch[0]));
  const worldcupPicks: { event: string; highestPercent: { pick: string; betType: string; confidence: 'High' | 'Medium' | 'Low' } }[] = picks.worldcup ?? [];

  // Record this run's picks against their real match IDs so they can be
  // graded once the games finish — matched back to wcData by event string,
  // the same "Team A vs Team B" key the AI is asked to echo back.
  const wcByEvent = new Map(wcData.map((g) => [`${g.homeTeam} vs ${g.awayTeam}`, g]));
  const newPickInputs = worldcupPicks
    .map((p) => {
      const game = wcByEvent.get(p.event);
      if (!game) return null;
      return {
        gameId: game.gameId,
        event: p.event,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        kickoff: game.kickoffISO,
        betType: p.highestPercent.betType,
        pick: p.highestPercent.pick,
        confidence: p.highestPercent.confidence,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  await recordPicks(pickHistory, newPickInputs).catch(() => {});

  return {
    worldcup: picks.worldcup ?? [],
    generatedAt: new Date().toISOString(),
    errors,
  };
}

// Wrapped in Next's persistent Data Cache (not a plain in-memory variable —
// see comment above) so the 20-minute TTL actually holds across requests
// hitting different serverless instances. If generatePicks() throws, the
// failed result is not cached, so the next request retries against the AI
// instead of getting stuck on a cached error.
const getCachedPicks = unstable_cache(generatePicks, ['sports-picks-ai-picks'], {
  revalidate: CACHE_TTL_SECONDS,
});

export async function GET() {
  try {
    const response = await getCachedPicks();
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({
      worldcup: [],
      generatedAt: new Date().toISOString(),
      errors: [`AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`],
    });
  }
}

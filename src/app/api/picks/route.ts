import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import Anthropic from '@anthropic-ai/sdk';
import {
  getWorldCupOdds,
  getBestLine,
  getLineDivergence,
  getFinishedScores,
  formatAmericanOdds,
  normalizeOutcomeName,
} from '@/lib/odds';
import { getWorldCupStandings, getTeamRecentForm, summarizeRecentForm } from '@/lib/soccer';
import { getPredictionMarkets } from '@/lib/predictionMarkets';
import { getWorldCupPlayerProps } from '@/lib/propline';
import { gradeAndSummarize, recordPicks } from '@/lib/pickHistory';
import { AiParlay, MatchPick } from '@/lib/types';

interface SportPicksResult {
  matches: MatchPick[];
  parlay: AiParlay | null;
  errors: string[];
}

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
    const secondFavorite = sorted[1] ?? favorite;

    const mockOption = (outcome: typeof favorite) => ({
      pick: outcome ? normalizeOutcomeName(outcome.name) : g.homeTeam,
      betType: 'Moneyline',
      odds: outcome ? formatAmericanOdds(outcome.price) : 'N/A',
      confidence: 'High' as const,
      explanation: `[Preview] Placeholder pick using real odds — not real analysis yet. Add a real ANTHROPIC_API_KEY to get actual reasoning here.`,
      counterpoint: null,
    });

    return {
      event: `${g.homeTeam} vs ${g.awayTeam}`,
      matchTime: g.kickoff,
      picks: [mockOption(favorite), mockOption(secondFavorite)],
    };
  });
}

function buildMockParlay(data: { homeTeam: string; awayTeam: string; mlRaw: { name: string; price: number }[] }[]): AiParlay | null {
  if (data.length < 3) return null;
  const legCount = data.length >= 4 ? 4 : 3;
  const legs = data.slice(0, legCount).map((g) => {
    const sorted = [...g.mlRaw].sort((a, b) => a.price - b.price); // most negative (favorite) first
    const favorite = sorted[0];
    return {
      event: `${g.homeTeam} vs ${g.awayTeam}`,
      pick: favorite ? normalizeOutcomeName(favorite.name) : g.homeTeam,
      betType: 'Moneyline',
      odds: favorite ? formatAmericanOdds(favorite.price) : 'N/A',
      reason: '[Preview] Placeholder leg using real odds — not real analysis yet.',
    };
  });
  return { legs, summary: '[Preview] Placeholder parlay combining favorites — not real analysis yet.' };
}

async function generatePicks(): Promise<SportPicksResult> {
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

  // Player props (anytime goalscorer, 2+ assists) from PropLine, matched to
  // these matches by team names — PropLine uses its own event IDs. Fetched
  // separately since it's a distinct provider from The Odds API, then merged
  // onto each match so the prompt template can read it like any other field.
  const playerPropsByMatch = await getWorldCupPlayerProps(
    wcData.map((g) => ({ homeTeam: g.homeTeam, awayTeam: g.awayTeam }))
  ).catch(() => new Map<string, { anytimeScorers: string | null; twoPlusAssists: string | null }>());

  const wcDataWithProps = wcData.map((g) => {
    const props = playerPropsByMatch.get(`${g.homeTeam} vs ${g.awayTeam}`);
    return {
      ...g,
      anytimeScorers: props?.anytimeScorers ?? null,
      twoPlusAssists: props?.twoPlusAssists ?? null,
    };
  });

  const hasWCData = wcData.length > 0;

  if (!hasWCData && !process.env.ANTHROPIC_API_KEY) {
    return { matches: [], parlay: null, errors: ['API keys not configured yet. See HANDOFF.md for setup instructions.'] };
  }

  if (MOCK_PICKS) {
    return { matches: buildMockWorldCup(wcData), parlay: buildMockParlay(wcData), errors };
  }

  // Build AI prompt
  const prompt = `You are a professional sports handicapper. For EVERY match listed below, produce your TOP 2 picks, ranked most likely to hit first. Consider ALL available markets as candidates: Moneyline (including Tie), Spread, Totals, Anytime Goal Scorer, and 2+ Assists (when those player props are listed for that match) — genuinely weigh all of them, don't default to Moneyline out of habit and don't reach for a player prop just for variety either.

Ranking rules:
- Rank purely by how confident you genuinely are that each pick will actually hit — this is a "will it happen" ranking, not a payout ranking. Pick 1 is your single most confident outcome for this match; Pick 2 is your second most confident outcome, and it must still be a real, credible pick you'd genuinely bet on — not just "whatever's next best if nothing else is likely."
- Form your own probability judgment from the stats, prediction-market data, and football knowledge below — do NOT just mechanically pick the two shortest-odds/lowest-payout favorites on the board because they look "safe." If your analysis says the market is off on a given outcome (over- or under-pricing it), weight your own read over the raw odds. It's fine and often correct for your top picks to match the market favorites when they genuinely are the most likely outcomes — just make sure you actually did the analysis rather than defaulting to it.
- Don't fill both slots with player props — Moneyline/Tie, Spread, and Totals are real, often higher-probability markets. Only pick a player prop when it's genuinely one of your two most confident outcomes for this specific match (e.g. a team's clear #1 striker at a very short price against a weak defense), not by default.
- Be wary of defaulting to an outright Moneyline winner in a genuinely close match. If the odds and prediction markets show the two sides bunched near a coinflip (no outcome clearly favored — e.g. moneyline prices for both teams are similar, or Kalshi/Polymarket cluster near 45-55%), guessing which side wins outright is a weak bet. Tie, or a Spread/Totals line, is very often the sharper, more confidently-hittable pick in a truly even match than betting on one side's outright win — don't rank an outright-win pick above Tie just because Moneyline is the default market people reach for first.

IMPORTANT: The "Anytime goal scorer" and "2+ assists" lines below are pre-filtered to only the handful of most likely candidates per match — treat this as the realistic shortlist, not the full roster. If a match has no such lines listed, no player props are available for it — don't invent players or props that aren't shown.

IMPORTANT: Anytime-goalscorer props are lower true-probability than they can feel, even for a team's best player — a genuinely elite striker in great form still typically has only around a 25-45% real chance of scoring in any single match, meaningfully under 50% more often than not. Never assign High confidence to an anytime-goalscorer pick; cap it at Medium at most, and only include one at all when the specific matchup is exceptional (a very short price, a clearly weak opposing defense, strong current scoring form) — not just because a recognizable star name is available on the board.

Use everything provided below to determine the pick and your confidence level: the odds from the sportsbooks listed, Kalshi and Polymarket prediction market prices (these reflect real money betting on the actual outcome and are often sharper than sportsbook odds — weigh them heavily when estimating true win probability, especially when they disagree with the sportsbook implied probability), each team's group-stage record (record, goal difference, points), each team's actual last 5 match results (a stronger "how are they playing right now" signal than the aggregate record — weight recent form heavily, especially if it diverges from the season-long record), and your own general knowledge of these national teams. That general knowledge should actively cover, wherever relevant: overall squad quality and depth; individual player tendencies and strengths (e.g. a team's top scorer's finishing quality, a key playmaker's creativity and passing range, a goalkeeper's shot-stopping reputation, a defender prone to mistakes); each team's typical tactical strategy and style of play (possession-based vs. counter-attacking, high press vs. low block, set-piece threat, defensive solidity, how they set up against stronger vs. weaker opponents); historical head-to-head results or tournament history between these two teams if it's notable; and anything you know about current injuries or squad news. Don't limit your reasoning to just the numeric stats provided — actively factor in this tactical and player-level knowledge, not just as a passing mention.

IMPORTANT: Apply two additional analyst lenses to every pick before finalizing it — don't just take the raw odds or your first instinct at face value:
1. Model-vs-market gap check (sharp-bettor lens): when your own read of the stats/form/tactical matchup disagrees with what the sportsbook price and/or Kalshi/Polymarket implies, weigh your own analysis over the market rather than silently defaulting to whichever side is already favored. The market is often right, but it's also a common failure mode to just restate the favorite without doing real analysis — if you're going to agree with the market, make sure it's because the data actually supports it, not because it's convenient.
2. Public-bias / "trap game" check: nationally famous, historically elite, or fan-favorite teams (e.g. Brazil, Argentina, France, England, Germany) routinely draw shorter odds and heavier public confidence than their CURRENT form and squad actually justify, because casual bettors back the name and history rather than this tournament's actual form. Before picking a big-name team, explicitly check that the pick holds up on THIS tournament's real stats/form/tactical matchup — not reputation. If a big-name team's current form doesn't clearly support the market's confidence in them, treat that gap as a real signal to lower confidence or favor the other side/Tie instead.

IMPORTANT: Do not treat two teams' records as equivalent just because the win/loss/goal numbers look similar — weigh the QUALITY of the opponents that produced those results, and each team's overall strength as a squad (talent level, star players, depth, typical tactical level versus the other major national teams). A loss to a top-tier team (e.g. Argentina, France, Brazil, England — elite squads by current form and player quality) is a very different signal than a loss to a weak team, even if the scoreline or record looks comparable. Use this reasoning transitively: if Team A lost a close, competitive match to a top-tier team, and Team B beat a weak team, Team A is likely still the stronger side and should usually be favored over Team B, even with a similar W-D-L record. Bake this strength-of-schedule and squad-quality judgment into both the pick and the confidence level, not just the raw stats.

IMPORTANT: Refer to a tied-match outcome as "Tie", never "Draw", in both the pick and the explanation.

IMPORTANT: Some matches include a "Line divergence" note — how widely sportsbooks disagree with each other on the same outcome's implied win probability. This is a soft market-uncertainty signal only, not a real fixing-detection tool (that requires account-level betting data no public odds API provides). It does NOT indicate which side is more likely to win. Never claim, imply, or speculate that a match is fixed, manipulated, or rigged. When a match is flagged, the only appropriate uses are: (1) treat it as a reason to be more conservative — e.g. drop confidence from High to Medium — and (2) optionally add one brief, neutrally-worded bullet like "sportsbooks disagree more than usual on this line" if genuinely relevant. Do not speculate about why.

IMPORTANT: Do NOT mention, cite, or name-drop "Kalshi", "Polymarket", "prediction markets", or their specific prices anywhere in the explanation text. Use that data silently to inform your pick and confidence — the explanation should read as your own analysis, sourced from odds, stats, and football knowledge only. If you're relying on general knowledge rather than the sportsbook/stats data provided (e.g. injury news), say so plainly rather than stating it as verified fact — you do not have a live injury feed.
${trackRecord.promptText ? `
IMPORTANT: Here is your own track record on past picks, graded against actual results: ${trackRecord.promptText} Use this only as a light calibration signal — if a market type has been underperforming, lean a little more conservative (e.g. High → Medium) there specifically, and vice versa if it's been hitting well. This is a small sample, so don't let it override what the actual data for a given match tells you, and never mention this track record in the explanation text.
` : ''}

IMPORTANT: Each pick may have a "counterpoint" field — one short sentence giving the single best, most credible real reason this specific pick might NOT hit, grounded in the actual data/knowledge above (a stat, a tactical matchup, a specific player, recent form, historical head-to-head). Play devil's advocate honestly here — this should be a genuine, real risk, not a throwaway line. If a pick is genuinely close to a lock — the gap in quality, form, or matchup is too lopsided for a real counter-case to exist — set "counterpoint" to null instead of manufacturing a weak reason. Do NOT write filler like "No real case here" — either give a real, specific reason it might not hit, or use null. Never contradict or undercut your own pick and confidence level; this is a risk-awareness note when a genuine one exists, not a second opinion.

Each pick needs its own "explanation", shown in a dedicated detail view. Format each as 3-4 short bullet points, NOT one long paragraph — each bullet starts with "• ". Since this whole response must be valid JSON, separate bullets using the two-character escape sequence \n (backslash followed by the letter n) inside the JSON string — do NOT insert a raw/literal line break. Keep each explanation tight, roughly 60-90 words total across all bullets combined, but still information-dense — every bullet should carry a real, specific fact, not filler. Cover whichever of these are most relevant to that specific pick (you don't need all of them every time): what the sportsbook odds imply and whether that's justified; the key form/stats angle (group-stage record, goal difference); a specific tactical/style-of-play matchup detail (pressing, possession, set pieces, how one team's approach exploits the other's weakness); a specific player tendency or player-level detail (a key scorer, playmaker, or defensive liability by name, clearly flagged as general knowledge, not live data); an injury or squad note if relevant (same caveat); historical head-to-head context if it matters. Prefer specific, named details (a player, a tactical trait, a stat) over generic statements like "has a strong squad." Write each bullet as a punchy, specific claim — no throat-clearing, no restating the obvious.

In addition to the per-match picks above, also build ONE overall "AI Parlay" for today — your single best combination of picks across ALL the matches listed, chosen because you have genuine, strong confidence each leg individually hits AND that the combination realistically hits together.

Parlay rules:
- Use 4 legs ONLY if you have genuine high confidence in all 4 individually. Otherwise use exactly 3. Never fewer than 3, never more than 4.
- Each leg must be pulled from the same markets/data already provided above for these matches (Moneyline/Tie, Spread, Totals, Anytime Goal Scorer, or 2+ Assists) — don't invent a market or price that isn't in the data.
- Strongly prefer legs from different matches so the parlay's outcomes are genuinely independent of each other. Only include two legs from the same match if you have a specific, well-reasoned case for why they're not just paying twice for the same event, and say so explicitly in that leg's "reason".
- Actively choose the legs — across all matches — that you would genuinely combine into one parlay today. This is not "copy your top pick from 3-4 random matches"; weigh which specific combination has the best realistic chance of ALL legs hitting together.
- If fewer than 3 matches have usable market data, set "parlay" to the JSON value null instead of forcing a weak combination.
- Each leg needs a one-sentence "reason" it's included. Also write a 1-2 sentence "summary" for the whole parlay explaining the combination.

${hasWCData ? `
=== WORLD CUP 2026 — UPCOMING MATCHES ===
${wcDataWithProps.map((g, i) => `
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
${g.anytimeScorers ? `Anytime goal scorer (most likely candidates): ${g.anytimeScorers}` : ''}
${g.twoPlusAssists ? `2+ assists in the match (longshot props): ${g.twoPlusAssists}` : ''}
${g.lineDivergence.flagged ? `Line divergence: FLAGGED — sportsbooks disagree by ~${g.lineDivergence.maxSpreadPct} points on ${g.lineDivergence.outcome}'s implied probability` : ''}
`).join('\n')}
` : 'No upcoming World Cup matches with posted odds right now.'}

Return a JSON object with this exact structure:
{
  "worldcup": [
    {
      "event": "Team A vs Team B",
      "matchTime": "Fri, Jul 3 · 3:00 PM ET",
      "picks": [
        {
          "pick": "Team A -0.5",
          "betType": "Spread",
          "odds": "+110",
          "confidence": "High",
          "explanation": "• Bullet one: a specific fact (e.g. odds/implied probability)\n• Bullet two: another specific fact (e.g. form or stats)\n• Bullet three: tactical, injury, or historical note if relevant",
          "counterpoint": null
        },
        {
          "pick": "Tie",
          "betType": "Moneyline",
          "odds": "+220",
          "confidence": "Medium",
          "explanation": "• Same bullet-point format as above",
          "counterpoint": "One short sentence on the best real reason this might not hit."
        }
      ]
    }
  ],
  "parlay": {
    "legs": [
      { "event": "Team A vs Team B", "pick": "Team A -0.5", "betType": "Spread", "odds": "+110", "reason": "One sentence on why this leg is in the parlay." },
      { "event": "Team C vs Team D", "pick": "Tie", "betType": "Moneyline", "odds": "+220", "reason": "One sentence on why this leg is in the parlay." },
      { "event": "Team E vs Team F", "pick": "Over 2.5", "betType": "Totals", "odds": "-115", "reason": "One sentence on why this leg is in the parlay." }
    ],
    "summary": "One or two sentences on why this specific combination."
  }
}

Rules:
- Every match listed must get exactly 2 entries in "picks", ranked most likely to hit first — do not skip any match, and do not return more or fewer than 2.
- "counterpoint" must be either a real, specific sentence or the JSON value null — never an empty string or a placeholder like "No real case here."
- Consider all matches listed above, whether they're today or several days out — do not limit yourself to only today's games.
- Include the match date in "matchTime" (e.g. "Fri, Jul 3 · 3:00 PM ET") so it's clear which day each pick is for.
- Confidence: High = very likely to win, Medium = probably wins but real risk exists, Low = leaning this way but genuinely uncertain
- If no upcoming World Cup matches are listed, return an empty array
- "parlay" must have exactly 3 or 4 entries in "legs", or be the JSON value null if fewer than 3 matches have usable market data — never 1, 2, or 5+.
- Always return valid JSON only, no other text`;

  const message = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 8000, // two picks per match, each with its own explanation + counterpoint
    messages: [{ role: 'user', content: prompt }],
  });

  // Sonnet 5 uses adaptive thinking by default, so the text block isn't
  // necessarily content[0] — a thinking block can come first.
  const textBlock = message.content.find((block) => block.type === 'text');
  const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON in AI response. stop_reason:', message.stop_reason, 'text:', text.slice(0, 2000));
    throw new Error('No JSON in AI response');
  }

  let picks;
  try {
    picks = JSON.parse(sanitizeJsonText(jsonMatch[0]));
  } catch (err) {
    console.error('JSON parse failed. stop_reason:', message.stop_reason, 'raw:', jsonMatch[0].slice(0, 3000));
    throw err;
  }
  const worldcupPicks: { event: string; picks: { pick: string; betType: string; confidence: 'High' | 'Medium' | 'Low' }[] }[] = picks.worldcup ?? [];

  // Record this run's picks against their real match IDs so they can be
  // graded once the games finish — matched back to wcData by event string,
  // the same "Team A vs Team B" key the AI is asked to echo back. Only the
  // top-ranked pick (index 0) is tracked for calibration, same as before.
  const wcByEvent = new Map(wcData.map((g) => [`${g.homeTeam} vs ${g.awayTeam}`, g]));
  const newPickInputs = worldcupPicks
    .map((p) => {
      const game = wcByEvent.get(p.event);
      const topPick = p.picks?.[0];
      if (!game || !topPick) return null;
      return {
        gameId: game.gameId,
        event: p.event,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        kickoff: game.kickoffISO,
        betType: topPick.betType,
        pick: topPick.pick,
        confidence: topPick.confidence,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  await recordPicks(pickHistory, newPickInputs).catch(() => {});

  // Defensively validate the AI's parlay shape rather than trusting it
  // outright — a malformed parlay shouldn't take down the whole picks
  // response, it should just fall back to no parlay this cycle.
  const rawParlay = picks.parlay;
  const parlay: AiParlay | null =
    rawParlay &&
    Array.isArray(rawParlay.legs) &&
    (rawParlay.legs.length === 3 || rawParlay.legs.length === 4) &&
    typeof rawParlay.summary === 'string'
      ? { legs: rawParlay.legs, summary: rawParlay.summary }
      : null;

  return { matches: picks.worldcup ?? [], parlay, errors };
}

// Wrapped in Next's persistent Data Cache (not a plain in-memory variable —
// see comment above) so the 20-minute TTL actually holds across requests
// hitting different serverless instances. If the generator throws, the
// failed result is not cached, so the next request retries against the AI
// instead of getting stuck on a cached error.
const getCachedWorldCupPicks = unstable_cache(generatePicks, ['sports-picks-ai-picks-soccer'], {
  revalidate: CACHE_TTL_SECONDS,
});

export async function GET() {
  try {
    const worldcupResult = await getCachedWorldCupPicks();

    return NextResponse.json({
      worldcup: worldcupResult.matches,
      parlay: worldcupResult.parlay,
      generatedAt: new Date().toISOString(),
      errors: worldcupResult.errors,
    });
  } catch (err) {
    return NextResponse.json({
      worldcup: [],
      parlay: null,
      generatedAt: new Date().toISOString(),
      errors: [`AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`],
    });
  }
}

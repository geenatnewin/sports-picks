import { get, put } from '@vercel/blob';
import { FinishedScore } from './odds';
import { getKalshiMarketResult } from './predictionMarkets';

export interface StoredPick {
  gameId: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  betType: string;
  pick: string;
  confidence: 'High' | 'Medium' | 'Low';
  kickoff: string; // ISO
  generatedAt: string; // ISO
  graded: boolean;
  result?: 'win' | 'loss' | 'push';
  // Only set for "To Advance" picks — a regulation-time score can't tell us
  // who actually advanced, so grading looks up Kalshi's own settlement
  // instead (see gradeToAdvancePick below).
  kalshiTicker?: string;
}

const HISTORY_PATH = 'pick-history.json';

async function readHistory(): Promise<StoredPick[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const blob = await get(HISTORY_PATH, { access: 'private' });
    if (!blob || blob.statusCode !== 200) return [];
    const text = await new Response(blob.stream).text();
    return JSON.parse(text) as StoredPick[];
  } catch {
    return [];
  }
}

async function writeHistory(history: StoredPick[]): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(HISTORY_PATH, JSON.stringify(history), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch {
    // Track record is a soft signal, not core functionality — swallow write
    // failures rather than breaking pick generation over it.
  }
}

// Parses the trailing line value out of a pick string like "Argentina -1.5"
// or "Over 2.5". Moneyline picks (just a team/tie name) have no number.
function parsePoint(pick: string): number | null {
  const match = pick.trim().match(/([+-]?\d+(\.\d+)?)\s*$/);
  return match ? parseFloat(match[1]) : null;
}

export interface GradableOutcome {
  pick: string;
  homeTeam: string;
  awayTeam: string;
  betType: string;
}

// Both the Game Props browser and the AI's own picks now label markets
// "Full Time Goals" and "Win or Refund" (renamed from "Total Goals"/"Totals"
// and "Draw No Bet" for user clarity) — but stored history/slips already
// generated under the old labels, including real currently-pending picks not
// yet graded, still carry them. Alias every historical label into the same
// stable internal grading key so a pick or leg from any era grades correctly,
// regardless of which label was live when it was recorded.
export function normalizeBetType(betType: string): string {
  const lower = betType.toLowerCase();
  if (lower === 'total goals' || lower === 'full time goals') return 'totals';
  if (lower === 'draw no bet') return 'win or refund';
  return lower;
}

// Shared grading logic for anything that resolves against a regulation-time
// score — reused for both AI-generated picks (pickHistory) and manually
// placed parlay legs (slipHistory), so the two can't silently drift apart.
export function gradeOutcome(outcome: GradableOutcome, score: FinishedScore): 'win' | 'loss' | 'push' {
  const pickLower = outcome.pick.toLowerCase();
  const homeLower = outcome.homeTeam.toLowerCase();
  const awayLower = outcome.awayTeam.toLowerCase();
  const betType = normalizeBetType(outcome.betType);
  const margin = score.homeScore - score.awayScore; // positive = home won

  if (betType === 'totals') {
    const line = parsePoint(outcome.pick);
    if (line === null) return 'push';
    const total = score.homeScore + score.awayScore;
    const isOver = pickLower.includes('over');
    if (total === line) return 'push';
    const overHit = total > line;
    return overHit === isOver ? 'win' : 'loss';
  }

  if (betType === 'spread') {
    const line = parsePoint(outcome.pick);
    const pickIsHome = pickLower.includes(homeLower);
    if (line === null) return 'push';
    const adjustedMargin = pickIsHome ? margin + line : -margin + line;
    if (adjustedMargin === 0) return 'push';
    return adjustedMargin > 0 ? 'win' : 'loss';
  }

  const actualWinner = margin > 0 ? 'home' : margin < 0 ? 'away' : 'tie';

  if (betType === 'win or refund') {
    // Refunds instead of losing when regulation ends level — never grade
    // a Win or Refund pick as a loss just because the match was a draw.
    if (actualWinner === 'tie') return 'push';
    if (pickLower.includes(homeLower)) return actualWinner === 'home' ? 'win' : 'loss';
    if (pickLower.includes(awayLower)) return actualWinner === 'away' ? 'win' : 'loss';
    return 'push';
  }

  // Moneyline (default)
  if (pickLower.includes('tie')) return actualWinner === 'tie' ? 'win' : 'loss';
  if (pickLower.includes(homeLower)) return actualWinner === 'home' ? 'win' : 'loss';
  if (pickLower.includes(awayLower)) return actualWinner === 'away' ? 'win' : 'loss';
  return 'push'; // couldn't match the pick text to either team — don't guess
}

export interface NewPickInput {
  gameId: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  betType: string;
  pick: string;
  confidence: 'High' | 'Medium' | 'Low';
  kalshiTicker?: string;
}

export interface TrackRecordSummary {
  promptText: string | null;
}

const MIN_GRADED_FOR_SUMMARY = 3;

function summarize(history: StoredPick[]): TrackRecordSummary {
  const graded = history.filter((h) => h.graded && h.result);
  if (graded.length < MIN_GRADED_FOR_SUMMARY) return { promptText: null };

  const tally = (list: StoredPick[]) => {
    const wins = list.filter((h) => h.result === 'win').length;
    const losses = list.filter((h) => h.result === 'loss').length;
    const pushes = list.filter((h) => h.result === 'push').length;
    const decided = wins + losses;
    const pct = decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null;
    return { wins, losses, pushes, pct };
  };

  const overall = tally(graded);
  const byMarket = ['Moneyline', 'Win or Refund', 'To Advance', 'Spread', 'Full Time Goals']
    .map((market) => ({ market, ...tally(graded.filter((h) => h.betType === market)) }))
    .filter((m) => m.wins + m.losses + m.pushes > 0);

  const lines = [
    `Overall: ${overall.wins}-${overall.losses}${overall.pushes ? `-${overall.pushes}` : ''} (${overall.pct ?? 'N/A'}% ) across ${graded.length} graded picks.`,
    ...byMarket.map((m) => `${m.market}: ${m.wins}-${m.losses}${m.pushes ? `-${m.pushes}` : ''} (${m.pct ?? 'N/A'}%).`),
  ];

  return { promptText: lines.join(' ') };
}

// Reads the stored pick history, grades any picks whose match has since
// finished against real final scores, persists the update, and returns a
// short track-record summary to feed into the AI prompt as a calibration
// signal. New picks from the current run are recorded separately via
// recordPicks() once the AI response is available.
export async function gradeAndSummarize(finishedScores: FinishedScore[]): Promise<{
  history: StoredPick[];
  summary: TrackRecordSummary;
}> {
  const history = await readHistory();
  const scoresById = new Map(finishedScores.map((s) => [s.gameId, s]));

  let gradedAnyNew = false;
  for (const pick of history) {
    if (pick.graded) continue;

    // "To Advance" can't be graded from a regulation-time score — a knockout
    // tie can go to extra time/penalties, which the score alone doesn't
    // resolve. Ask Kalshi directly instead, since it's the source of truth
    // this pick was actually made against.
    if (pick.betType.toLowerCase() === 'to advance' && pick.kalshiTicker) {
      const result = await getKalshiMarketResult(pick.kalshiTicker);
      if (result === null) continue; // not settled yet
      pick.result = result === 'yes' ? 'win' : 'loss';
      pick.graded = true;
      gradedAnyNew = true;
      continue;
    }

    const score = scoresById.get(pick.gameId);
    if (!score) continue;
    pick.result = gradeOutcome(pick, score);
    pick.graded = true;
    gradedAnyNew = true;
  }

  // Persist newly-graded results immediately — this is a fact worth saving
  // regardless of what the caller does next (e.g. it may bail out early on
  // MOCK_PICKS or missing data before ever calling recordPicks()).
  if (gradedAnyNew) await writeHistory(history);

  return { history, summary: summarize(history) };
}

// Upserts this run's picks into the in-memory history (keyed by gameId, so
// re-generating a pick for a match that hasn't kicked off yet just updates
// the stored pick rather than creating a duplicate entry) and persists it.
export async function recordPicks(history: StoredPick[], picks: NewPickInput[]): Promise<void> {
  const byGameId = new Map(history.map((h) => [h.gameId, h]));

  for (const p of picks) {
    const existing = byGameId.get(p.gameId);
    if (existing?.graded) continue; // match already finished and graded — leave it alone
    const entry: StoredPick = {
      gameId: p.gameId,
      event: p.event,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      betType: p.betType,
      pick: p.pick,
      confidence: p.confidence,
      kickoff: p.kickoff,
      generatedAt: new Date().toISOString(),
      graded: false,
      kalshiTicker: p.kalshiTicker,
    };
    byGameId.set(p.gameId, entry);
  }

  await writeHistory(Array.from(byGameId.values()));
}

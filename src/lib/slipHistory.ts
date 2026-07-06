import { get, put } from '@vercel/blob';
import { FinishedScore } from './odds';
import { gradeOutcome } from './pickHistory';
import { getKalshiMarketResult } from './predictionMarkets';

// Tracks parlay slips the user has actually placed (as opposed to
// pickHistory.ts, which tracks every AI-generated pick whether the user
// acted on it or not) — this is a feedback signal specifically about what
// the user chose to bet, fed into the AI prompt as its own calibration
// signal alongside the existing track record.

export interface StoredSlipLeg {
  event: string;
  homeTeam: string;
  awayTeam: string;
  marketLabel: string;
  selectionLabel: string;
  odds: number;
  kalshiTicker?: string;
  graded: boolean;
  result?: 'win' | 'loss' | 'push';
}

export interface StoredSlip {
  id: string;
  legs: StoredSlipLeg[];
  stake: number;
  combinedAmerican: number;
  payout: number;
  placedAt: string; // ISO
  graded: boolean; // true once every leg has a result
  result?: 'win' | 'loss' | 'push'; // loss if any leg lost, push if no loss but any push, else win
}

const SLIPS_PATH = 'placed-slips.json';

async function readSlips(): Promise<StoredSlip[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const blob = await get(SLIPS_PATH, { access: 'private' });
    if (!blob || blob.statusCode !== 200) return [];
    const text = await new Response(blob.stream).text();
    return JSON.parse(text) as StoredSlip[];
  } catch {
    return [];
  }
}

async function writeSlips(slips: StoredSlip[]): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(SLIPS_PATH, JSON.stringify(slips), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export interface NewSlipLegInput {
  event: string;
  marketLabel: string;
  selectionLabel: string;
  odds: number;
  kalshiTicker?: string;
}

export interface NewSlipInput {
  legs: NewSlipLegInput[];
  stake: number;
  combinedAmerican: number;
  payout: number;
}

export async function listSlips(): Promise<StoredSlip[]> {
  return readSlips();
}

export async function recordSlip(input: NewSlipInput): Promise<StoredSlip> {
  const slips = await readSlips();
  const entry: StoredSlip = {
    id: `${Date.now()}`,
    stake: input.stake,
    combinedAmerican: input.combinedAmerican,
    payout: input.payout,
    placedAt: new Date().toISOString(),
    graded: false,
    legs: input.legs.map((l) => {
      const [homeTeam, awayTeam] = l.event.split(' vs ').map((s) => s.trim());
      return {
        event: l.event,
        homeTeam: homeTeam ?? '',
        awayTeam: awayTeam ?? '',
        marketLabel: l.marketLabel,
        selectionLabel: l.selectionLabel,
        odds: l.odds,
        kalshiTicker: l.kalshiTicker,
        graded: false,
      };
    }),
  };
  await writeSlips([entry, ...slips]);
  return entry;
}

export async function removeSlip(id: string): Promise<void> {
  const slips = await readSlips();
  await writeSlips(slips.filter((s) => s.id !== id));
}

// Grades any ungraded legs whose match has since finished, then rolls each
// slip's overall result up from its legs (loss if any leg lost, push if no
// loss but at least one push, otherwise win — good enough for a calibration
// signal, not a full parlay-payout recalculation).
export async function gradeSlips(finishedScores: FinishedScore[]): Promise<StoredSlip[]> {
  const slips = await readSlips();
  const scoresByTeams = new Map(finishedScores.map((s) => [`${s.homeTeam} vs ${s.awayTeam}`, s]));

  let changed = false;
  for (const slip of slips) {
    if (slip.graded) continue;

    for (const leg of slip.legs) {
      if (leg.graded) continue;

      if (leg.marketLabel.toLowerCase() === 'to advance') {
        if (!leg.kalshiTicker) continue; // no ticker captured at placement time — can't grade
        const result = await getKalshiMarketResult(leg.kalshiTicker);
        if (result === null) continue; // not settled yet
        leg.result = result === 'yes' ? 'win' : 'loss';
        leg.graded = true;
        changed = true;
        continue;
      }

      const score = scoresByTeams.get(leg.event);
      if (!score) continue;
      leg.result = gradeOutcome(
        { pick: leg.selectionLabel, homeTeam: leg.homeTeam, awayTeam: leg.awayTeam, betType: leg.marketLabel },
        score
      );
      leg.graded = true;
      changed = true;
    }

    if (slip.legs.every((l) => l.graded)) {
      slip.graded = true;
      slip.result = slip.legs.some((l) => l.result === 'loss')
        ? 'loss'
        : slip.legs.some((l) => l.result === 'push')
          ? 'push'
          : 'win';
      changed = true;
    }
  }

  if (changed) await writeSlips(slips);
  return slips;
}

export interface SlipTrackRecordSummary {
  promptText: string | null;
}

const MIN_GRADED_SLIPS_FOR_SUMMARY = 3;

// Summarizes the user's own actually-placed slips (not every AI pick) for
// the prompt — a distinct signal from pickHistory's "every pick generated"
// track record, since it reflects what the user actually chose to act on.
export function summarizeSlips(slips: StoredSlip[]): SlipTrackRecordSummary {
  const graded = slips.filter((s) => s.graded && s.result);
  if (graded.length < MIN_GRADED_SLIPS_FOR_SUMMARY) return { promptText: null };

  const wins = graded.filter((s) => s.result === 'win').length;
  const losses = graded.filter((s) => s.result === 'loss').length;
  const pushes = graded.filter((s) => s.result === 'push').length;
  const decided = wins + losses;
  const pct = decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null;

  return {
    promptText: `The user's own actually-placed slips have gone ${wins}-${losses}${pushes ? `-${pushes}` : ''} (${pct ?? 'N/A'}%) across ${graded.length} graded slips.`,
  };
}

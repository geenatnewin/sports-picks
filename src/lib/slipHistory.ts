import { get, put, BlobPreconditionFailedError, BlobError } from '@vercel/blob';
import { FinishedScore } from './odds';
import { gradeOutcome, normalizeBetType } from './pickHistory';
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

async function readSlipsWithEtag(): Promise<{ slips: StoredSlip[]; etag: string | null }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { slips: [], etag: null };
  try {
    const blob = await get(SLIPS_PATH, { access: 'private' });
    if (!blob || blob.statusCode !== 200) return { slips: [], etag: null };
    const text = await new Response(blob.stream).text();
    return { slips: JSON.parse(text) as StoredSlip[], etag: blob.blob.etag };
  } catch {
    return { slips: [], etag: null };
  }
}

async function readSlips(): Promise<StoredSlip[]> {
  return (await readSlipsWithEtag()).slips;
}

const MAX_WRITE_ATTEMPTS = 5;

// The SDK is documented to throw BlobPreconditionFailedError on an ifMatch
// conflict, but observed directly (via a standalone concurrency test against
// this store) it can also surface as a plain BlobError with a "bad_request"
// code carrying the same underlying message — check both rather than trust
// the documented type alone.
function isEtagConflict(err: unknown): boolean {
  if (err instanceof BlobPreconditionFailedError) return true;
  return err instanceof BlobError && /conditional request|conflicting operation|precondition/i.test(err.message);
}

// Vercel Blob's put() has no true read-modify-write transaction, so two
// requests that read the list around the same time can otherwise silently
// clobber each other (observed directly: a manually-backfilled slip vanished
// when it collided with a real slip placed seconds later). ifMatch turns the
// write into a compare-and-swap — a stale write is rejected instead of
// overwriting, and we just re-read the latest list and retry the mutation.
async function mutateSlips(mutate: (current: StoredSlip[]) => StoredSlip[]): Promise<StoredSlip[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return mutate([]);

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { slips: current, etag } = await readSlipsWithEtag();
    const next = mutate(current);
    try {
      await put(SLIPS_PATH, JSON.stringify(next), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        ...(etag ? { ifMatch: etag } : {}),
      });
      return next;
    } catch (err) {
      if (isEtagConflict(err) && attempt < MAX_WRITE_ATTEMPTS) {
        continue; // another write landed first — re-read and retry the mutation
      }
      throw err;
    }
  }
  throw new Error('mutateSlips: exhausted retry attempts');
}

export interface NewSlipLegInput {
  event: string;
  marketLabel: string;
  selectionLabel: string;
  odds: number;
  kalshiTicker?: string;
  // Only set when backfilling an already-settled bet placed outside this app
  // (e.g. on another betting site) purely for the calibration signal — lets
  // it be recorded pre-graded instead of waiting on this app's own
  // finished-score matching, which only looks back a short window anyway.
  result?: 'win' | 'loss' | 'push';
}

export interface NewSlipInput {
  legs: NewSlipLegInput[];
  stake: number;
  combinedAmerican: number;
  payout: number;
  // Only set when backfilling a historical bet — overrides the default
  // "recorded now" timestamp so the history reflects when it was actually placed.
  placedAt?: string;
}

export async function listSlips(): Promise<StoredSlip[]> {
  return readSlips();
}

export async function recordSlip(input: NewSlipInput): Promise<StoredSlip> {
  const legs: StoredSlipLeg[] = input.legs.map((l) => {
    const [homeTeam, awayTeam] = l.event.split(' vs ').map((s) => s.trim());
    return {
      event: l.event,
      homeTeam: homeTeam ?? '',
      awayTeam: awayTeam ?? '',
      marketLabel: l.marketLabel,
      selectionLabel: l.selectionLabel,
      odds: l.odds,
      kalshiTicker: l.kalshiTicker,
      graded: !!l.result,
      result: l.result,
    };
  });
  const allGraded = legs.every((l) => l.graded);
  const entry: StoredSlip = {
    id: `${Date.now()}`,
    stake: input.stake,
    combinedAmerican: input.combinedAmerican,
    payout: input.payout,
    placedAt: input.placedAt ?? new Date().toISOString(),
    graded: allGraded,
    result: allGraded
      ? legs.some((l) => l.result === 'loss')
        ? 'loss'
        : legs.some((l) => l.result === 'push')
          ? 'push'
          : 'win'
      : undefined,
    legs,
  };
  await mutateSlips((current) => [entry, ...current]);
  return entry;
}

// Grades any ungraded legs whose match has since finished, then rolls each
// slip's overall result up from its legs (loss if any leg lost, push if no
// loss but at least one push, otherwise win — good enough for a calibration
// signal, not a full parlay-payout recalculation).
//
// Kalshi lookups are async, so grading decisions are computed once up front
// against an initial read, then applied inside mutateSlips's retry loop by
// slip id + leg index — a retry re-reads the latest list and reapplies the
// same precomputed decisions rather than re-querying Kalshi each attempt.
export async function gradeSlips(finishedScores: FinishedScore[]): Promise<StoredSlip[]> {
  const { slips: initial } = await readSlipsWithEtag();
  const scoresByTeams = new Map(finishedScores.map((s) => [`${s.homeTeam} vs ${s.awayTeam}`, s]));

  const decisions = new Map<string, 'win' | 'loss' | 'push'>();

  for (const slip of initial) {
    if (slip.graded) continue;

    for (let i = 0; i < slip.legs.length; i++) {
      const leg = slip.legs[i];
      if (leg.graded) continue;

      if (leg.marketLabel.toLowerCase() === 'to advance') {
        if (!leg.kalshiTicker) continue; // no ticker captured at placement time — can't grade
        const result = await getKalshiMarketResult(leg.kalshiTicker);
        if (result === null) continue; // not settled yet
        decisions.set(`${slip.id}:${i}`, result === 'yes' ? 'win' : 'loss');
        continue;
      }

      const score = scoresByTeams.get(leg.event);
      if (!score) continue;
      const result = gradeOutcome(
        { pick: leg.selectionLabel, homeTeam: leg.homeTeam, awayTeam: leg.awayTeam, betType: leg.marketLabel },
        score
      );
      decisions.set(`${slip.id}:${i}`, result);
    }
  }

  if (decisions.size === 0) return initial;

  return mutateSlips((current) => {
    for (const slip of current) {
      if (slip.graded) continue;

      for (let i = 0; i < slip.legs.length; i++) {
        const leg = slip.legs[i];
        if (leg.graded) continue;
        const decided = decisions.get(`${slip.id}:${i}`);
        if (decided === undefined) continue;
        leg.result = decided;
        leg.graded = true;
      }

      if (slip.legs.every((l) => l.graded)) {
        slip.graded = true;
        slip.result = slip.legs.some((l) => l.result === 'loss')
          ? 'loss'
          : slip.legs.some((l) => l.result === 'push')
            ? 'push'
            : 'win';
      }
    }
    return current;
  });
}

export interface SlipTrackRecordSummary {
  promptText: string | null;
}

const MIN_GRADED_SLIPS_FOR_SUMMARY = 3;

// Maps pickHistory's normalized (lowercase, alias-collapsed) market keys back
// to the current user-facing label, so a leg stored under an old market name
// (e.g. "Total Goals" or "Draw No Bet") still buckets with its current-name
// counterpart instead of fragmenting the breakdown across renames.
const MARKET_LABELS: Record<string, string> = {
  moneyline: 'Moneyline',
  spread: 'Spread',
  totals: 'Full Time Goals',
  'win or refund': 'Win or Refund',
  'to advance': 'To Advance',
};

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

  const byMarket = new Map<string, { wins: number; losses: number; pushes: number }>();
  for (const slip of graded) {
    for (const leg of slip.legs) {
      if (!leg.graded || !leg.result) continue;
      const key = normalizeBetType(leg.marketLabel);
      const tally = byMarket.get(key) ?? { wins: 0, losses: 0, pushes: 0 };
      if (leg.result === 'win') tally.wins++;
      else if (leg.result === 'loss') tally.losses++;
      else tally.pushes++;
      byMarket.set(key, tally);
    }
  }

  const marketLines = Array.from(byMarket.entries()).map(([key, t]) => {
    const label = MARKET_LABELS[key] ?? key;
    const marketDecided = t.wins + t.losses;
    const marketPct = marketDecided > 0 ? Math.round((t.wins / marketDecided) * 1000) / 10 : null;
    return `${label}: ${t.wins}-${t.losses}${t.pushes ? `-${t.pushes}` : ''} (${marketPct ?? 'N/A'}%)`;
  });

  return {
    promptText: `The user's own actually-placed slips have gone ${wins}-${losses}${pushes ? `-${pushes}` : ''} (${pct ?? 'N/A'}%) across ${graded.length} graded slips. By market (leg-level): ${marketLines.join(', ')}.`,
  };
}

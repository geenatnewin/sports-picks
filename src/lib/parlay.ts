export interface ParlayLeg {
  id: string;
  event: string;
  marketLabel: string;
  selectionLabel: string;
  odds: number; // American odds
  // Only set for a "To Advance" leg — needed to grade it against Kalshi's
  // own settlement later, since the event may no longer be queryable by
  // team name once that market closes (see slipHistory.ts).
  kalshiTicker?: string;
  graded?: boolean;
  result?: 'win' | 'loss' | 'push';
}

export interface PlacedSlip {
  id: string;
  legs: ParlayLeg[];
  stake: number;
  combinedAmerican: number;
  payout: number;
  placedAt: string; // ISO timestamp
  graded: boolean;
  result?: 'win' | 'loss' | 'push';
}

export function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function calculateParlay(legs: ParlayLeg[], stake: number) {
  const combinedDecimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  const combinedAmerican = legs.length > 0 ? decimalToAmerican(combinedDecimal) : 0;
  const payout = stake * combinedDecimal;
  const profit = payout - stake;
  return { combinedDecimal, combinedAmerican, payout, profit };
}

'use client';

import { PlacedSlip, formatAmerican } from '@/lib/parlay';

const RESULT_STYLES: Record<'win' | 'loss' | 'push' | 'pending', string> = {
  win: 'text-green-400 bg-green-400/10',
  loss: 'text-red-400 bg-red-400/10',
  push: 'text-neutral-400 bg-neutral-400/10',
  pending: 'text-amber-400 bg-amber-400/10',
};

const RESULT_LABELS: Record<'win' | 'loss' | 'push' | 'pending', string> = {
  win: 'WON',
  loss: 'LOST',
  push: 'PUSH',
  pending: 'PENDING',
};

export default function MySlips({ slips }: { slips: PlacedSlip[] }) {
  if (slips.length === 0) {
    return (
      <div className="card-elevated rounded-lg p-6 text-center">
        <p className="text-neutral-500 text-sm">No slips placed yet — build a parlay below and hit &quot;Place Bet&quot;</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {slips.map((slip) => {
        const status = slip.graded && slip.result ? slip.result : 'pending';
        return (
        <div key={slip.id} className="card-elevated rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-600 text-xs">
              {new Date(slip.placedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${RESULT_STYLES[status]}`}>
              {RESULT_LABELS[status]}
            </span>
          </div>
          <div className="space-y-1.5 mb-3">
            {slip.legs.map((leg) => (
              <div key={leg.id} className="flex items-center justify-between text-sm gap-3">
                <div className="min-w-0">
                  <span className="text-white/90">{leg.selectionLabel}</span>
                  <span className="text-neutral-600 text-xs ml-2">
                    {leg.event} · {leg.marketLabel}
                  </span>
                </div>
                <span className="text-red-400 font-medium whitespace-nowrap">{formatAmerican(leg.odds)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-sm pt-3 border-t border-white/[0.06]">
            <span className="text-neutral-500">
              Stake ${slip.stake} · Combined {formatAmerican(slip.combinedAmerican)}
            </span>
            <span className="text-white/90 font-semibold">${slip.payout.toFixed(2)} payout</span>
          </div>
        </div>
        );
      })}
    </div>
  );
}

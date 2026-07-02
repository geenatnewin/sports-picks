'use client';

import { useState } from 'react';
import { ParlayLeg, calculateParlay, formatAmerican } from '@/lib/parlay';

export default function ParlaySlip({
  legs,
  onRemove,
  onClear,
  onPlace,
}: {
  legs: ParlayLeg[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onPlace: (stake: number, combinedAmerican: number, payout: number) => void;
}) {
  const [stake, setStake] = useState(10);
  const [open, setOpen] = useState(false);

  if (legs.length === 0) return null;

  const { combinedAmerican, payout, profit } = calculateParlay(legs, stake);

  const handlePlace = () => {
    onPlace(stake, combinedAmerican, payout);
    setOpen(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 px-0 sm:px-4">
      <div className="max-w-2xl mx-auto">
        {open && (
          <div className="panel-elevated-top bg-[#211e1b] border-t border-x border-white/10 rounded-t-xl px-4 pt-4 pb-3 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="text-white/90 font-semibold text-sm">My Parlay ({legs.length})</p>
              <button onClick={onClear} className="text-neutral-500 hover:text-neutral-300 text-xs">
                Clear all
              </button>
            </div>
            <div className="space-y-2 mb-4">
              {legs.map((leg) => (
                <div
                  key={leg.id}
                  className="chip-elevated flex items-center justify-between rounded-lg px-3 py-2"
                >
                  <div>
                    <p className="text-white/90 text-sm font-medium">{leg.selectionLabel}</p>
                    <p className="text-neutral-500 text-xs">
                      {leg.event} · {leg.marketLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-red-400 text-sm font-semibold">{formatAmerican(leg.odds)}</span>
                    <button
                      onClick={() => onRemove(leg.id)}
                      className="text-neutral-600 hover:text-red-400 text-lg leading-none"
                      aria-label="Remove leg"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mb-2">
              <label className="text-neutral-500 text-xs" htmlFor="parlay-stake">
                Stake $
              </label>
              <input
                id="parlay-stake"
                type="number"
                min={1}
                value={stake}
                onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 0))}
                className="bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1 text-sm text-white/90 w-20"
              />
            </div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-neutral-500">Payout if it hits</span>
              <span className="text-white/90 font-semibold">
                ${payout.toFixed(2)} <span className="text-red-400">(+${profit.toFixed(2)})</span>
              </span>
            </div>
            <button
              onClick={handlePlace}
              className="btn-raised w-full bg-red-600 hover:bg-red-500 rounded-lg py-2.5 text-sm font-semibold text-white mt-1"
            >
              Place Bet
            </button>
            <p className="text-neutral-700 text-[11px] text-center mt-2">For fun only — not a real bet.</p>
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="btn-raised panel-elevated-top w-full flex items-center justify-between bg-red-600 hover:bg-red-500 px-4 py-3 text-sm font-semibold text-white rounded-t-xl sm:rounded-b-xl"
        >
          <span>
            {legs.length} leg{legs.length !== 1 ? 's' : ''} · Combined {formatAmerican(combinedAmerican)}
          </span>
          <span>{open ? 'Hide' : 'View'} Parlay</span>
        </button>
      </div>
    </div>
  );
}

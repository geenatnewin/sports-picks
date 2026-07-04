'use client';

import { AiParlay } from '@/lib/types';
import { ParlayLeg, calculateParlay, formatAmerican } from '@/lib/parlay';

function parseAmericanOdds(odds: string): number {
  const n = parseInt(odds.replace(/[^-\d]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

export default function AiParlayBox({
  parlay,
  loading,
  onAddToSlip,
}: {
  parlay: AiParlay | null;
  loading: boolean;
  onAddToSlip: (legs: ParlayLeg[]) => void;
}) {
  if (loading) {
    return (
      <div className="card-elevated rounded-xl p-5">
        <div className="h-4 w-20 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="space-y-3">
          <div className="h-16 bg-white/5 rounded-lg animate-pulse" />
          <div className="h-16 bg-white/5 rounded-lg animate-pulse" />
          <div className="h-16 bg-white/5 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!parlay || parlay.legs.length === 0) {
    return (
      <div className="card-elevated rounded-xl p-5 text-center">
        <p className="text-neutral-500 text-xs uppercase tracking-widest mb-2">AI Parlay</p>
        <p className="text-neutral-600 text-sm">Not enough matches today for a confident parlay</p>
      </div>
    );
  }

  const parlayLegs: ParlayLeg[] = parlay.legs.map((leg, i) => ({
    id: `ai-parlay-${i}`,
    event: leg.event,
    marketLabel: leg.betType,
    selectionLabel: leg.pick,
    odds: parseAmericanOdds(leg.odds),
  }));

  const { combinedAmerican } = calculateParlay(parlayLegs, 10);

  return (
    <div className="card-elevated rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-neutral-500 text-xs uppercase tracking-widest">AI Parlay</p>
        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-500/15 text-red-300 border border-red-500/30 whitespace-nowrap">
          {parlay.legs.length}-Leg
        </span>
      </div>

      <div className="space-y-3 mb-4">
        {parlay.legs.map((leg, i) => (
          <div key={i} className="chip-elevated rounded-lg p-3">
            <p className="text-neutral-600 text-[11px] uppercase tracking-wide mb-1 truncate">{leg.event}</p>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white/90 font-semibold text-sm truncate">{leg.pick}</p>
                <p className="text-neutral-600 text-xs">{leg.betType}</p>
              </div>
              <p className={`font-bold text-sm whitespace-nowrap ${leg.odds.startsWith('+') ? 'text-red-400' : 'text-white/90'}`}>
                {leg.odds}
              </p>
            </div>
            <p className="text-neutral-500 text-xs mt-2 leading-relaxed">{leg.reason}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4 pt-3 border-t border-white/[0.06]">
        <p className="text-neutral-500 text-xs uppercase tracking-widest">Combined Odds</p>
        <p className="text-white/90 font-bold">{formatAmerican(combinedAmerican)}</p>
      </div>

      <p className="text-neutral-500 text-xs leading-relaxed mb-4">{parlay.summary}</p>

      <button
        onClick={() => onAddToSlip(parlayLegs)}
        className="btn-raised w-full text-sm font-semibold py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
      >
        Add All to Parlay Slip
      </button>
    </div>
  );
}

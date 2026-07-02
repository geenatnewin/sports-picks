'use client';

import { Pick } from '@/lib/types';

const confidenceStyles = {
  High: 'bg-red-500/15 text-red-300 border border-red-500/30',
  Medium: 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30',
  Low: 'bg-white/[0.06] text-neutral-300 border border-white/10',
};

const confidenceDot = {
  High: 'bg-red-400',
  Medium: 'bg-yellow-400',
  Low: 'bg-neutral-400',
};

export default function PickCard({ pick }: { pick: Pick }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-5 hover:border-red-500/20 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-neutral-500 text-xs uppercase tracking-widest mb-1">{pick.betType}</p>
          <p className="text-white/90 font-semibold text-sm leading-tight">{pick.event}</p>
          {pick.matchTime && (
            <p className="text-neutral-600 text-xs mt-0.5">{pick.matchTime}</p>
          )}
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap flex items-center gap-1.5 ${confidenceStyles[pick.confidence]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${confidenceDot[pick.confidence]}`} />
          {pick.confidence}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="bg-white/[0.03] border border-white/[0.05] rounded-lg px-4 py-2 flex-1">
          <p className="text-neutral-500 text-xs mb-0.5">Pick</p>
          <p className="text-white/90 font-bold text-base">{pick.pick}</p>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.05] rounded-lg px-4 py-2">
          <p className="text-neutral-500 text-xs mb-0.5">Odds</p>
          <p className={`font-bold text-base ${pick.odds.startsWith('+') ? 'text-red-400' : 'text-white/90'}`}>
            {pick.odds}
          </p>
        </div>
      </div>

      <p className="text-neutral-500 text-sm leading-relaxed">{pick.explanation}</p>
    </div>
  );
}

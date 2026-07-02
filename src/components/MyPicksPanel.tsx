'use client';

import { useState } from 'react';
import { PlacedSlip } from '@/lib/parlay';
import MySlips from './MySlips';

export default function MyPicksPanel({
  slips,
  onRemoveSlip,
}: {
  slips: PlacedSlip[];
  onRemoveSlip: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button — fixed to the viewport, so it stays put while the page scrolls */}
      <button
        onClick={() => setOpen(true)}
        aria-label="My Picks"
        title="My Picks"
        className="btn-raised fixed bottom-24 right-4 z-30 w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white"
      >
        <span className="text-xl leading-none">🎟️</span>
        {slips.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-white text-red-600 text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
            {slips.length}
          </span>
        )}
      </button>

      {/* Backdrop — click outside the panel to close it */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Slide-out panel — homepage stays visible on the left */}
      <div
        className={`panel-elevated-left fixed right-0 top-0 z-50 h-full w-full max-w-sm bg-[#1e1c1a] border-l border-white/10 flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06] flex-shrink-0">
          <p className="text-white/90 font-semibold text-base">My Picks</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <MySlips slips={slips} onRemove={onRemoveSlip} />
        </div>
      </div>
    </>
  );
}

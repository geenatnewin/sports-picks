'use client';

import { useEffect, useState, useCallback } from 'react';
import MarketsBrowser from '@/components/MarketsBrowser';
import ParlaySlip from '@/components/ParlaySlip';
import MyPicksPanel from '@/components/MyPicksPanel';
import { PicksResponse } from '@/lib/types';
import { ParlayLeg, PlacedSlip } from '@/lib/parlay';

const SLIPS_STORAGE_KEY = 'harppicks-my-slips';

function SectionHeader({
  emoji,
  title,
  count,
  open,
  onToggle,
}: {
  emoji: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full relative flex flex-col items-center text-center gap-3 mb-4 pb-3 border-b border-white/[0.06] ${
        open ? 'sticky top-36 z-10 bg-[#191715]/95 backdrop-blur shadow-[0_8px_20px_-10px_rgba(0,0,0,0.6)]' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl opacity-70">{emoji}</span>
        <div>
          <h2 className="text-white/90 font-semibold text-base tracking-tight">{title}</h2>
          <p className="text-neutral-600 text-xs">{count} upcoming pick{count !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <svg
        className={`absolute right-0 top-1 w-4 h-4 text-neutral-500 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

export default function Home() {
  const [data, setData] = useState<PicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [legs, setLegs] = useState<ParlayLeg[]>([]);
  const [wcOpen, setWcOpen] = useState(false);
  const [wcTab, setWcTab] = useState<'gameProps' | 'playerProps' | null>(null);
  const [placedSlips, setPlacedSlips] = useState<PlacedSlip[]>([]);

  // Load saved slips from this browser once on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SLIPS_STORAGE_KEY);
      if (saved) setPlacedSlips(JSON.parse(saved));
    } catch {
      // ignore corrupted storage
    }
  }, []);

  const toggleLeg = useCallback((leg: ParlayLeg) => {
    setLegs((prev) => {
      const exists = prev.find((l) => l.id === leg.id);
      if (exists) return prev.filter((l) => l.id !== leg.id);
      return [...prev, leg];
    });
  }, []);

  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clearLegs = useCallback(() => setLegs([]), []);

  const placeBet = useCallback(
    (stake: number, combinedAmerican: number, payout: number) => {
      setPlacedSlips((prev) => {
        const next = [
          {
            id: `${Date.now()}`,
            legs,
            stake,
            combinedAmerican,
            payout,
            placedAt: new Date().toISOString(),
          },
          ...prev,
        ];
        localStorage.setItem(SLIPS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setLegs([]);
    },
    [legs]
  );

  const removeSlip = useCallback((id: string) => {
    setPlacedSlips((prev) => {
      const next = prev.filter((s) => s.id !== id);
      localStorage.setItem(SLIPS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchPicks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/picks');
      if (!res.ok) throw new Error('Failed to fetch picks');
      const json: PicksResponse = await res.json();
      setData(json);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPicks();
  }, [fetchPicks]);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const hasNoData = data && data.worldcup.length === 0;
  const aiFailed = data?.errors?.some((e) => e.includes('AI analysis failed')) ?? false;

  return (
    <div className="min-h-screen bg-[#191715] text-neutral-100">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#191715]/80 backdrop-blur sticky top-0 z-10 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)]">
        <div className="max-w-2xl mx-auto px-4 py-8 relative flex flex-col items-center text-center">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight px-8">
            <span className="brand-word">Dylan Harper&apos;s &quot;Trust Me&quot; Locks</span>
          </h1>
          <p className="text-neutral-600 text-xs mt-5">
            {today}
            {lastUpdated && !loading && <> · Last updated {lastUpdated}</>}
          </p>
          <button
            onClick={fetchPicks}
            disabled={loading}
            className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300 disabled:opacity-50 text-xs uppercase tracking-wider transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <main className={`max-w-2xl mx-auto px-4 py-6 space-y-8 ${legs.length > 0 ? 'pb-24' : ''}`}>
        {/* Status bar */}
        {lastUpdated && !loading && data?.errors && data.errors.length > 0 && (
          <p className="text-amber-600 text-xs text-center">Some data sources unavailable</p>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* API keys not configured notice */}
        {hasNoData && data?.errors?.some(e => e.includes('API keys')) && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 text-center">
            <p className="text-amber-400 font-semibold mb-1">Setup Required</p>
            <p className="text-neutral-400 text-sm">Add your API keys to <code className="text-amber-300">.env.local</code> to get live picks.</p>
            <p className="text-neutral-500 text-xs mt-2">See HANDOFF.md in the project folder for step-by-step instructions.</p>
          </div>
        )}

        {/* World Cup Section */}
        <section>
          <SectionHeader
            emoji="⚽"
            title="World Cup 2026"
            count={loading ? 0 : (data?.worldcup.length ?? 0)}
            open={wcOpen}
            onToggle={() => setWcOpen((o) => !o)}
          />
          {wcOpen && (
            <div className="space-y-6">
              {/* Tabs */}
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => setWcTab('gameProps')}
                  className={`chip-elevated text-sm px-4 py-2 rounded-lg ${
                    wcTab === 'gameProps' ? 'chip-selected text-red-300' : 'text-neutral-300'
                  }`}
                >
                  Game Props
                </button>
                <button
                  onClick={() => setWcTab('playerProps')}
                  className={`chip-elevated text-sm px-4 py-2 rounded-lg ${
                    wcTab === 'playerProps' ? 'chip-selected text-red-300' : 'text-neutral-300'
                  }`}
                >
                  Player Props
                </button>
              </div>

              {wcTab === 'gameProps' && (
                <div>
                  <p className="text-neutral-600 text-xs uppercase tracking-widest mb-3 text-center">
                    Tap any line to add it to your parlay
                  </p>
                  {aiFailed && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 text-center mb-4">
                      <p className="text-amber-400 text-sm font-medium mb-1">Odds are live, but pick generation failed</p>
                      <p className="text-neutral-500 text-xs">
                        Check that <code className="text-amber-300">ANTHROPIC_API_KEY</code> in .env.local is a real key, not the placeholder.
                      </p>
                    </div>
                  )}
                  <MarketsBrowser
                    legs={legs}
                    onToggle={toggleLeg}
                    picks={data?.worldcup ?? []}
                    picksLoading={loading}
                    aiFailed={aiFailed}
                  />
                </div>
              )}

              {wcTab === 'playerProps' && (
                <div className="card-elevated rounded-lg p-6 text-center">
                  <p className="text-neutral-500 text-sm">Player props coming soon</p>
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="text-center text-neutral-700 text-xs pb-4">
          For entertainment only. Please bet responsibly.
        </footer>
      </main>

      <ParlaySlip legs={legs} onRemove={removeLeg} onClear={clearLegs} onPlace={placeBet} />
      <MyPicksPanel slips={placedSlips} onRemoveSlip={removeSlip} />
    </div>
  );
}

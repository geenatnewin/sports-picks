'use client';

import { useEffect, useState, useCallback } from 'react';
import MarketsBrowser from '@/components/MarketsBrowser';
import ParlaySlip from '@/components/ParlaySlip';
import MyPicksPanel from '@/components/MyPicksPanel';
import { PicksResponse } from '@/lib/types';
import { ParlayLeg, PlacedSlip } from '@/lib/parlay';

const SLIPS_STORAGE_KEY = 'harppicks-my-slips';

type Sport = 'soccer' | 'mlb';

const SPORTS: { id: Sport; label: string; emoji: string; accent: string; active: string; bar: string; chipSelected: string }[] = [
  {
    id: 'soccer',
    label: 'World Cup',
    emoji: '⚽',
    accent: 'text-red-400',
    active: 'border-red-500/40 bg-red-500/10',
    bar: 'bg-red-500',
    chipSelected: 'chip-selected',
  },
  {
    id: 'mlb',
    label: 'MLB',
    emoji: '⚾',
    accent: 'text-amber-400',
    active: 'border-amber-500/40 bg-amber-500/10',
    bar: 'bg-amber-500',
    chipSelected: 'chip-selected-amber',
  },
];

export default function Home() {
  const [data, setData] = useState<PicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [legs, setLegs] = useState<ParlayLeg[]>([]);
  const [sport, setSport] = useState<Sport>('soccer');
  const [tab, setTab] = useState<'gameProps' | 'playerProps'>('gameProps');
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

  const activeSport = SPORTS.find((s) => s.id === sport)!;
  const currentPicks = sport === 'soccer' ? (data?.worldcup ?? []) : (data?.mlb ?? []);
  const hasNoData = data && currentPicks.length === 0;
  const aiFailed = data?.errors?.some((e) => e.includes('AI analysis failed')) ?? false;

  return (
    <div className="min-h-screen bg-[#191715] text-neutral-100 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="shrink-0 border-b md:border-b-0 md:border-r border-white/[0.06] bg-[#141210] px-4 py-5 md:py-6 md:min-h-screen md:w-56 flex flex-col gap-6 md:gap-8">
        <div className="px-2">
          <h1 className="text-base md:text-lg font-bold leading-tight">
            <span className="brand-word">Dylan Harper&apos;s</span>
          </h1>
          <p className="text-neutral-500 text-xs mt-1">&quot;Trust Me&quot; Locks</p>
        </div>

        <nav className="flex flex-row md:flex-col gap-2">
          {SPORTS.map((s) => {
            const count = s.id === 'soccer' ? (data?.worldcup.length ?? 0) : (data?.mlb.length ?? 0);
            const isActive = sport === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSport(s.id)}
                className={`flex-1 md:flex-none flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  isActive ? s.active : 'border-transparent hover:bg-white/[0.04]'
                }`}
              >
                <span className="text-xl">{s.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm font-semibold truncate ${isActive ? s.accent : 'text-neutral-200'}`}>
                    {s.label}
                  </span>
                  <span className="block text-xs text-neutral-600">
                    {loading ? '…' : `${count} pick${count !== 1 ? 's' : ''}`}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="md:mt-auto px-2 hidden md:flex flex-col gap-2">
          <button
            onClick={fetchPicks}
            disabled={loading}
            className="chip-elevated flex items-center justify-center gap-1.5 text-neutral-400 hover:text-neutral-200 disabled:opacity-50 text-xs uppercase tracking-wider py-2 rounded-lg transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <p className="text-neutral-700 text-[11px] text-center leading-relaxed">
            {today}
            {lastUpdated && !loading && <><br />Updated {lastUpdated}</>}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className={`flex-1 max-w-2xl mx-auto w-full px-4 py-6 md:py-8 space-y-6 ${legs.length > 0 ? 'pb-24' : ''}`}>
        {lastUpdated && !loading && data?.errors && data.errors.length > 0 && (
          <p className="text-amber-600 text-xs text-center">Some data sources unavailable</p>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {hasNoData && data?.errors?.some((e) => e.includes('API keys')) && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 text-center">
            <p className="text-amber-400 font-semibold mb-1">Setup Required</p>
            <p className="text-neutral-400 text-sm">Add your API keys to <code className="text-amber-300">.env.local</code> to get live picks.</p>
            <p className="text-neutral-500 text-xs mt-2">See HANDOFF.md in the project folder for step-by-step instructions.</p>
          </div>
        )}

        <section>
          <div className="relative flex items-center gap-3 mb-5 pb-3 border-b border-white/[0.06]">
            <span className={`absolute -top-6 left-0 h-0.5 w-10 rounded-full ${activeSport.bar}`} />
            <span className="text-2xl">{activeSport.emoji}</span>
            <div className="flex-1">
              <h2 className={`font-bold text-lg tracking-tight ${activeSport.accent}`}>{activeSport.label}</h2>
              <p className="text-neutral-600 text-xs">
                {loading ? 'Loading…' : `${currentPicks.length} pick${currentPicks.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              onClick={fetchPicks}
              disabled={loading}
              className="md:hidden flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300 disabled:opacity-50 text-xs uppercase tracking-wider"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          <div className="flex justify-center gap-2 mb-6">
            <button
              onClick={() => setTab('gameProps')}
              className={`chip-elevated text-sm px-4 py-2 rounded-lg ${
                tab === 'gameProps' ? `${activeSport.chipSelected} ${activeSport.accent}` : 'text-neutral-300'
              }`}
            >
              Game Props
            </button>
            <button
              onClick={() => setTab('playerProps')}
              className={`chip-elevated text-sm px-4 py-2 rounded-lg ${
                tab === 'playerProps' ? `${activeSport.chipSelected} ${activeSport.accent}` : 'text-neutral-300'
              }`}
            >
              Player Props
            </button>
          </div>

          {tab === 'gameProps' && (
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
                picks={currentPicks}
                picksLoading={loading}
                aiFailed={aiFailed}
                sport={sport}
              />
            </div>
          )}

          {tab === 'playerProps' && (
            <div className="card-elevated rounded-lg p-6 text-center">
              <p className="text-neutral-500 text-sm">Player props coming soon</p>
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

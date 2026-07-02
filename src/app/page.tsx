'use client';

import { useEffect, useState, useCallback } from 'react';
import PickCard from '@/components/PickCard';
import { PicksResponse } from '@/lib/types';

function SectionHeader({ emoji, title, count }: { emoji: string; title: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-white/[0.06]">
      <span className="text-xl opacity-70">{emoji}</span>
      <div>
        <h2 className="text-white/90 font-semibold text-base tracking-tight">{title}</h2>
        <p className="text-neutral-600 text-xs">{count} pick{count !== 1 ? 's' : ''} today</p>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-5 animate-pulse">
          <div className="flex justify-between mb-3">
            <div className="space-y-2">
              <div className="h-2 w-16 bg-white/10 rounded" />
              <div className="h-4 w-40 bg-white/10 rounded" />
            </div>
            <div className="h-6 w-16 bg-white/10 rounded-full" />
          </div>
          <div className="flex gap-3 mb-4">
            <div className="h-14 flex-1 bg-white/10 rounded-lg" />
            <div className="h-14 w-20 bg-white/10 rounded-lg" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 bg-white/10 rounded w-full" />
            <div className="h-3 bg-white/10 rounded w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<PicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

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

  const hasNoData = data && data.worldcup.length === 0 && data.golf.length === 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-neutral-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-8 relative flex flex-col items-center text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="brand-word">HarpPICKS</span>
          </h1>
          <p className="text-neutral-600 text-xs mt-2">{today}</p>
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

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {/* Status bar */}
        {lastUpdated && !loading && (
          <p className="text-neutral-600 text-xs text-center">
            Last updated {lastUpdated}
            {data?.errors && data.errors.length > 0 && (
              <span className="text-amber-600"> · Some data sources unavailable</span>
            )}
          </p>
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
          />
          {loading ? (
            <Skeleton />
          ) : data && data.worldcup.length > 0 ? (
            <div className="space-y-4">
              {data.worldcup.map((pick, i) => (
                <PickCard key={i} pick={pick} />
              ))}
            </div>
          ) : !loading && (
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-6 text-center">
              <p className="text-neutral-500 text-sm">No World Cup matches today</p>
            </div>
          )}
        </section>

        {/* Golf Section */}
        <section>
          <SectionHeader
            emoji="⛳"
            title="Golf"
            count={loading ? 0 : (data?.golf.length ?? 0)}
          />
          {loading ? (
            <Skeleton />
          ) : data && data.golf.length > 0 ? (
            <div className="space-y-4">
              {data.golf.map((pick, i) => (
                <PickCard key={i} pick={pick} />
              ))}
            </div>
          ) : !loading && (
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-6 text-center">
              <p className="text-neutral-500 text-sm">No active golf tournament this week</p>
            </div>
          )}
        </section>

        <footer className="text-center text-neutral-700 text-xs pb-4">
          For entertainment only. Please bet responsibly.
        </footer>
      </main>
    </div>
  );
}

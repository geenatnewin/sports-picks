'use client';

import { useEffect, useState } from 'react';
import { ParlayLeg } from '@/lib/parlay';
import { MatchPick } from '@/lib/types';

interface OddsOutcome {
  id: string;
  label: string;
  odds: string;
  oddsValue: number;
}

interface OddsMarket {
  key: string;
  label: string;
  outcomes: OddsOutcome[];
}

interface FormResult {
  result: 'W' | 'D' | 'L';
  goalsFor: number | null;
  goalsAgainst: number | null;
  opponent: string;
}

interface OddsMatch {
  gameId: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  homeForm: FormResult[] | null;
  awayForm: FormResult[] | null;
  matchTime: string;
  markets: OddsMarket[];
}

const formResultStyles = {
  W: 'bg-red-500/15 text-red-300 border-red-500/30',
  D: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  L: 'bg-white/[0.05] text-neutral-500 border-white/10',
};

const formResultLabels = {
  W: 'W',
  D: 'T',
  L: 'L',
};

function FormRow({ teamName, form }: { teamName: string; form: FormResult[] | null }) {
  if (!form || form.length === 0) return null;
  return (
    <div>
      <p className="text-neutral-600 text-xs uppercase tracking-widest mb-2">{teamName} — L5</p>
      <div className="flex flex-wrap gap-2">
        {form.map((r, i) => (
          <span key={i} className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${formResultStyles[r.result]}`}>
            {formResultLabels[r.result]} {r.goalsFor ?? '?'}-{r.goalsAgainst ?? '?'} vs {r.opponent}
          </span>
        ))}
      </div>
    </div>
  );
}

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

function ConfidenceBadge({ confidence }: { confidence: 'High' | 'Medium' | 'Low' }) {
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap flex items-center gap-1.5 ${confidenceStyles[confidence]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${confidenceDot[confidence]}`} />
      {confidence}
    </span>
  );
}

function AiPickSummary({ pick, onClick }: { pick: MatchPick; onClick: () => void }) {
  const option = pick.highestPercent;
  return (
    <button onClick={onClick} className="chip-elevated rounded-lg p-5 w-full text-left">
      <div className="flex items-center justify-between mb-3">
        <p className="text-neutral-500 text-xs uppercase tracking-widest">Highest % to Hit</p>
        <ConfidenceBadge confidence={option.confidence} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-white/90 font-bold text-lg leading-tight">{option.pick}</p>
          <p className="text-neutral-600 text-xs mt-0.5">{option.betType}</p>
        </div>
        <p className={`font-bold text-lg whitespace-nowrap ${option.odds.startsWith('+') ? 'text-red-400' : 'text-white/90'}`}>
          {option.odds}
        </p>
      </div>
      <p className="text-neutral-600 text-xs mt-3 text-center">Tap for full analysis</p>
    </button>
  );
}

function PickDetailModal({ pick, onClose }: { pick: { event: string; matchTime: string; pick: MatchPick }; onClose: () => void }) {
  const option = pick.pick.highestPercent;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card rounded-xl p-5 max-w-sm w-full max-h-[80vh] overflow-y-auto relative"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-300 text-2xl leading-none"
        >
          ×
        </button>
        <p className="text-white/90 font-semibold text-sm pr-6">{pick.event}</p>
        <p className="text-neutral-600 text-xs mb-4">{pick.matchTime}</p>

        <div className="flex items-center justify-between mb-3">
          <p className="text-neutral-500 text-xs uppercase tracking-widest">Highest % to Hit</p>
          <ConfidenceBadge confidence={option.confidence} />
        </div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-white/90 font-bold text-xl leading-tight">{option.pick}</p>
            <p className="text-neutral-600 text-xs mt-0.5">{option.betType}</p>
          </div>
          <p className={`font-bold text-xl whitespace-nowrap ${option.odds.startsWith('+') ? 'text-red-400' : 'text-white/90'}`}>
            {option.odds}
          </p>
        </div>

        <p className="text-neutral-500 text-xs uppercase tracking-widest mb-2">Analysis</p>
        <p className="text-neutral-300 text-sm leading-relaxed whitespace-pre-line">{option.explanation}</p>
      </div>
    </div>
  );
}

export default function MarketsBrowser({
  legs,
  onToggle,
  picks,
  picksLoading,
  aiFailed,
}: {
  legs: ParlayLeg[];
  onToggle: (leg: ParlayLeg) => void;
  picks: MatchPick[];
  picksLoading: boolean;
  aiFailed: boolean;
}) {
  const [matches, setMatches] = useState<OddsMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailPick, setDetailPick] = useState<{ event: string; matchTime: string; pick: MatchPick } | null>(null);

  useEffect(() => {
    fetch('/api/odds')
      .then((r) => r.json())
      .then((d) => setMatches(d.matches))
      .finally(() => setLoading(false));
  }, []);

  const isSelected = (id: string) => legs.some((l) => l.id === id);
  const pickByEvent = new Map(picks.map((p) => [p.event, p]));

  if (loading) {
    return <p className="text-neutral-600 text-sm">Loading markets…</p>;
  }

  if (!matches || matches.length === 0) {
    return (
      <div className="card-elevated rounded-lg p-6 text-center">
        <p className="text-neutral-500 text-sm">No upcoming World Cup markets available right now</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {matches.map((match) => {
          const pick = pickByEvent.get(match.event);
          return (
            <div key={match.gameId} className="card-elevated rounded-xl p-6">
              <p className="text-white/90 font-semibold text-base">{match.event}</p>
              <p className="text-neutral-600 text-sm mb-4">{match.matchTime}</p>

              {(match.homeForm || match.awayForm) && (
                <div className="space-y-3 mb-5 pb-5 border-b border-white/[0.06]">
                  <FormRow teamName={match.homeTeam} form={match.homeForm} />
                  <FormRow teamName={match.awayTeam} form={match.awayForm} />
                </div>
              )}

              <div className="space-y-4 mb-5">
                {match.markets.map((market) => (
                  <div key={market.key}>
                    <p className="text-neutral-500 text-xs uppercase tracking-widest mb-2">{market.label}</p>
                    <div className="flex flex-wrap gap-2.5">
                      {market.outcomes.map((outcome) => {
                        const selected = isSelected(outcome.id);
                        return (
                          <button
                            key={outcome.id}
                            onClick={() =>
                              onToggle({
                                id: outcome.id,
                                event: match.event,
                                marketLabel: market.label,
                                selectionLabel: outcome.label,
                                odds: outcome.oddsValue,
                              })
                            }
                            className={`chip-elevated text-sm px-4 py-2 rounded-lg ${
                              selected ? 'chip-selected text-red-300' : 'text-neutral-300'
                            }`}
                          >
                            {outcome.label} <span className="text-neutral-500">{outcome.odds}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {picksLoading ? (
                <div className="chip-elevated rounded-lg p-4 h-24 animate-pulse" />
              ) : pick ? (
                <AiPickSummary
                  pick={pick}
                  onClick={() => setDetailPick({ event: match.event, matchTime: match.matchTime, pick })}
                />
              ) : aiFailed ? (
                <p className="text-amber-500 text-xs">AI pick unavailable — check your ANTHROPIC_API_KEY</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {detailPick && <PickDetailModal pick={detailPick} onClose={() => setDetailPick(null)} />}
    </>
  );
}

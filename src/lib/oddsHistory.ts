import { get, put } from '@vercel/blob';
import { formatAmericanOdds } from './odds';

interface LineEntry {
  name: string;
  price: number;
}

interface GameSnapshot {
  timestamp: string; // ISO
  h2h: LineEntry[];
}

type HistoryStore = Record<string, GameSnapshot[]>; // gameId -> snapshots, oldest first

const HISTORY_PATH = 'odds-history.json';
const MAX_SNAPSHOTS_PER_GAME = 20;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // drop snapshots older than 3 days

async function readHistory(): Promise<HistoryStore> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return {};
  try {
    const blob = await get(HISTORY_PATH, { access: 'private' });
    if (!blob || blob.statusCode !== 200) return {};
    const text = await new Response(blob.stream).text();
    return JSON.parse(text) as HistoryStore;
  } catch {
    return {};
  }
}

async function writeHistory(history: HistoryStore): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(HISTORY_PATH, JSON.stringify(history), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch {
    // Line-movement history is a soft signal, not core functionality —
    // swallow write failures rather than breaking pick generation over it.
  }
}

function formatMovement(entries: LineEntry[]): string {
  if (entries.length === 1) return `${formatAmericanOdds(entries[0].price)} (just started tracking — no trend yet)`;
  return entries.map((e) => formatAmericanOdds(e.price)).join(' → ');
}

export interface GameForSnapshot {
  gameId: string;
  kickoffISO: string;
  h2h: LineEntry[];
}

// Appends a current moneyline snapshot for each active game, prunes snapshots
// for matches that have already kicked off (pre-game line movement stops
// mattering once betting is effectively closed) or that have aged out,
// persists once, and returns a short natural-language movement description
// per game — one line per outcome, oldest to newest — to feed into the AI
// prompt so it can judge direction/momentum for whichever outcome it ends up
// picking.
export async function recordSnapshotsAndDescribeMovement(
  games: GameForSnapshot[]
): Promise<Map<string, string>> {
  const history = await readHistory();
  const now = Date.now();
  const activeIds = new Set(games.map((g) => g.gameId));

  // Drop history for games no longer in the active odds list (finished/removed).
  for (const gameId of Object.keys(history)) {
    if (!activeIds.has(gameId)) delete history[gameId];
  }

  const descriptions = new Map<string, string>();

  for (const game of games) {
    const kickoffMs = new Date(game.kickoffISO).getTime();
    const priorSnapshots = (history[game.gameId] ?? []).filter(
      (s) => now - new Date(s.timestamp).getTime() < MAX_AGE_MS
    );

    // Movement description only draws on pre-kickoff snapshots — once a
    // match is live, past line movement no longer bears on "bet now or wait."
    const preKickoff = priorSnapshots.filter((s) => new Date(s.timestamp).getTime() < kickoffMs);
    const names = Array.from(new Set(preKickoff.flatMap((s) => s.h2h.map((l) => l.name))));
    const text = names
      .map((name) => {
        const series = preKickoff.map((s) => s.h2h.find((l) => l.name === name)).filter((l): l is LineEntry => !!l);
        return series.length > 0 ? `${name}: ${formatMovement(series)}` : null;
      })
      .filter((s): s is string => s !== null)
      .join(' | ');
    descriptions.set(game.gameId, text || 'no line history yet for this match');

    // Only keep snapshotting while the match hasn't kicked off yet.
    if (now < kickoffMs) {
      const updated = [...priorSnapshots, { timestamp: new Date(now).toISOString(), h2h: game.h2h }];
      history[game.gameId] = updated.slice(-MAX_SNAPSHOTS_PER_GAME);
    } else {
      history[game.gameId] = priorSnapshots;
    }
  }

  await writeHistory(history);
  return descriptions;
}

const BASE = 'https://feeds.datagolf.com';
const KEY = process.env.DATAGOLF_API_KEY;

export async function getGolfRankings() {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/preds/get-dg-rankings?file_format=json&key=${KEY}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getTournamentPredictions() {
  if (!KEY) return null;
  try {
    const res = await fetch(
      `${BASE}/preds/pre-tournament?tour=pga&dead_heat=no&odds_format=american&file_format=json&key=${KEY}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getPlayerStrokesGained() {
  if (!KEY) return null;
  try {
    const res = await fetch(
      `${BASE}/preds/approach-skill?&file_format=json&key=${KEY}`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const BASE = 'https://api.football-data.org/v4';
const KEY = process.env.FOOTBALL_DATA_API_KEY;

const headers = () => ({ 'X-Auth-Token': KEY ?? '' });

export async function getWorldCupStandings() {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/competitions/2000/standings`, {
      headers: headers(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getWorldCupMatches() {
  if (!KEY) return null;
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `${BASE}/competitions/2000/matches?status=SCHEDULED&dateFrom=${today}&dateTo=${today}`,
      { headers: headers(), next: { revalidate: 900 } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getTeamRecentForm(teamId: number) {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}/teams/${teamId}/matches?status=FINISHED&limit=5`, {
      headers: headers(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface RecentFormMatch {
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  score: { winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null; fullTime: { home: number | null; away: number | null } };
}

// Turns the raw match list from getTeamRecentForm into a compact, readable
// string from the given team's own perspective, e.g.
// "W 2-0 vs South Africa | D 1-1 vs Brazil | L 0-1 vs Portugal"
export function summarizeRecentForm(data: { matches?: RecentFormMatch[] } | null, teamId: number): string | null {
  if (!data?.matches || data.matches.length === 0) return null;

  const results = data.matches.map((m) => {
    const isHome = m.homeTeam.id === teamId;
    const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
    const goalsFor = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const goalsAgainst = isHome ? m.score.fullTime.away : m.score.fullTime.home;

    let result = 'D';
    if (m.score.winner === 'HOME_TEAM') result = isHome ? 'W' : 'L';
    else if (m.score.winner === 'AWAY_TEAM') result = isHome ? 'L' : 'W';

    return `${result} ${goalsFor ?? '?'}-${goalsAgainst ?? '?'} vs ${opponent}`;
  });

  return results.join(' | ');
}

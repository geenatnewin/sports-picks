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

export interface FormResult {
  result: 'W' | 'D' | 'L';
  goalsFor: number | null;
  goalsAgainst: number | null;
  opponent: string;
}

// Structured version — each of the team's last 5 results from their own
// perspective, for rendering in the UI.
export function getRecentFormResults(data: { matches?: RecentFormMatch[] } | null, teamId: number): FormResult[] | null {
  if (!data?.matches || data.matches.length === 0) return null;

  return data.matches.map((m) => {
    const isHome = m.homeTeam.id === teamId;
    const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
    const goalsFor = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const goalsAgainst = isHome ? m.score.fullTime.away : m.score.fullTime.home;

    let result: 'W' | 'D' | 'L' = 'D';
    if (m.score.winner === 'HOME_TEAM') result = isHome ? 'W' : 'L';
    else if (m.score.winner === 'AWAY_TEAM') result = isHome ? 'L' : 'W';

    return { result, goalsFor, goalsAgainst, opponent };
  });
}

// Turns the raw match list from getTeamRecentForm into a compact, readable
// string from the given team's own perspective, e.g.
// "W 2-0 vs South Africa | D 1-1 vs Brazil | L 0-1 vs Portugal"
export function summarizeRecentForm(data: { matches?: RecentFormMatch[] } | null, teamId: number): string | null {
  const results = getRecentFormResults(data, teamId);
  if (!results) return null;
  return results.map((r) => `${r.result} ${r.goalsFor ?? '?'}-${r.goalsAgainst ?? '?'} vs ${r.opponent}`).join(' | ');
}

interface StandingsTeam {
  id: number;
  name: string;
  shortName?: string;
}

function findStandingsTeam(standings: { standings?: { table?: { team: StandingsTeam }[] }[] } | null, teamName: string): StandingsTeam | null {
  const rows = (standings?.standings ?? []).flatMap((s) => s.table ?? []);
  const needle = teamName.toLowerCase();
  const row = rows.find((r) => r.team.name.toLowerCase() === needle || r.team.shortName?.toLowerCase() === needle);
  return row?.team ?? null;
}

// Convenience: fetches standings + both teams' recent form in one call, for
// callers (like the Game Props browser) that just need one match's data.
export async function getMatchRecentForm(
  homeTeam: string,
  awayTeam: string
): Promise<{ homeForm: FormResult[] | null; awayForm: FormResult[] | null }> {
  const standings = await getWorldCupStandings();
  const homeTeamInfo = findStandingsTeam(standings, homeTeam);
  const awayTeamInfo = findStandingsTeam(standings, awayTeam);

  const [homeData, awayData] = await Promise.all([
    homeTeamInfo ? getTeamRecentForm(homeTeamInfo.id).catch(() => null) : Promise.resolve(null),
    awayTeamInfo ? getTeamRecentForm(awayTeamInfo.id).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    homeForm: homeTeamInfo ? getRecentFormResults(homeData, homeTeamInfo.id) : null,
    awayForm: awayTeamInfo ? getRecentFormResults(awayData, awayTeamInfo.id) : null,
  };
}

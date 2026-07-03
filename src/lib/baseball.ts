import { FormResult } from './soccer';

const BASE = 'https://statsapi.mlb.com/api/v1';

// AL (103) + NL (104) — no API key needed, this is a free public MLB API.
export async function getMlbStandings() {
  try {
    const season = new Date().getFullYear();
    const res = await fetch(`${BASE}/standings?leagueId=103,104&season=${season}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function ymd(date: Date): string {
  return date.toISOString().split('T')[0];
}

interface MlbScheduleGame {
  status: { detailedState: string };
  gameDate: string;
  teams: {
    home: { team: { id: number; name: string }; score?: number; isWinner?: boolean };
    away: { team: { id: number; name: string }; score?: number; isWinner?: boolean };
  };
}

// Last 5 finished games for a team, most recent first. A 14-day lookback
// comfortably covers 5 games even around off-days, without pulling a whole
// season's schedule.
export async function getTeamRecentForm(teamId: number): Promise<MlbScheduleGame[] | null> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
    const res = await fetch(
      `${BASE}/schedule?teamId=${teamId}&sportId=1&gameType=R&startDate=${ymd(start)}&endDate=${ymd(end)}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const games: MlbScheduleGame[] = (data.dates ?? []).flatMap((d: { games: MlbScheduleGame[] }) => d.games);
    return games
      .filter((g) => g.status.detailedState === 'Final')
      .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime())
      .slice(0, 5);
  } catch {
    return null;
  }
}

// Structured version — each of the team's last 5 results from their own
// perspective, for rendering in the UI. Baseball has no tie outcome, but
// this reuses soccer.ts's FormResult shape ('W'/'D'/'L') since the frontend
// FormRow component already renders it generically — 'D' just never occurs.
export function getRecentFormResults(games: MlbScheduleGame[] | null, teamId: number): FormResult[] | null {
  if (!games || games.length === 0) return null;

  return games.map((g) => {
    const isHome = g.teams.home.team.id === teamId;
    const mine = isHome ? g.teams.home : g.teams.away;
    const theirs = isHome ? g.teams.away : g.teams.home;
    return {
      result: mine.isWinner ? 'W' : 'L',
      goalsFor: mine.score ?? null,
      goalsAgainst: theirs.score ?? null,
      opponent: theirs.team.name,
    };
  });
}

export function summarizeRecentForm(games: MlbScheduleGame[] | null, teamId: number): string | null {
  const results = getRecentFormResults(games, teamId);
  if (!results) return null;
  return results.map((r) => `${r.result} ${r.goalsFor ?? '?'}-${r.goalsAgainst ?? '?'} vs ${r.opponent}`).join(' | ');
}

interface MlbStandingsTeam {
  id: number;
  name: string;
}

// The Odds API gives full team names ("Tampa Bay Rays"); MLB Stats API's
// standings response only gives the short mascot name ("Rays"). Match by
// substring instead of equality since mascot names are distinctive enough
// not to collide.
function findStandingsTeam(
  standings: { records?: { teamRecords?: { team: MlbStandingsTeam }[] }[] } | null,
  teamName: string
): MlbStandingsTeam | null {
  const rows = (standings?.records ?? []).flatMap((r) => r.teamRecords ?? []);
  const needle = teamName.toLowerCase();
  const row = rows.find((r) => needle.includes(r.team.name.toLowerCase()));
  return row?.team ?? null;
}

export async function getMatchRecentForm(
  homeTeam: string,
  awayTeam: string
): Promise<{ homeForm: FormResult[] | null; awayForm: FormResult[] | null }> {
  const standings = await getMlbStandings();
  const homeTeamInfo = findStandingsTeam(standings, homeTeam);
  const awayTeamInfo = findStandingsTeam(standings, awayTeam);

  const [homeGames, awayGames] = await Promise.all([
    homeTeamInfo ? getTeamRecentForm(homeTeamInfo.id).catch(() => null) : Promise.resolve(null),
    awayTeamInfo ? getTeamRecentForm(awayTeamInfo.id).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    homeForm: homeTeamInfo ? getRecentFormResults(homeGames, homeTeamInfo.id) : null,
    awayForm: awayTeamInfo ? getRecentFormResults(awayGames, awayTeamInfo.id) : null,
  };
}

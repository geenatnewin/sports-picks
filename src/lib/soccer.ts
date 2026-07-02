const BASE = 'https://api.football-data.org/v4';
const KEY = process.env.FOOTBALL_DATA_API_KEY;

const headers = () => ({ 'X-Auth-Token': KEY ?? '' });

export async function getWorldCupStandings() {
  if (!KEY) return null;
  try {
    // Competition ID 2000 = FIFA World Cup
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

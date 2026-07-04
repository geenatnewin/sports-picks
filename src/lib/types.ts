export interface PickOption {
  pick: string;
  betType: string;
  odds: string;
  confidence: 'High' | 'Medium' | 'Low';
  explanation: string;
  counterpoint: string | null;
}

export interface MatchPick {
  event: string;
  matchTime?: string;
  picks: PickOption[]; // exactly 2, ranked most likely to hit first
}

export interface AiParlayLeg {
  event: string;
  pick: string;
  betType: string;
  odds: string;
  reason: string;
}

export interface AiParlay {
  legs: AiParlayLeg[]; // exactly 3 or 4
  summary: string;
}

export interface PicksResponse {
  worldcup: MatchPick[];
  parlay: AiParlay | null;
  generatedAt: string;
  errors: string[];
}

export interface OddsGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

export interface Bookmaker {
  key: string;
  title: string;
  markets: Market[];
}

export interface Market {
  key: string;
  outcomes: Outcome[];
}

export interface Outcome {
  name: string;
  price: number;
  point?: number;
}

export interface Pick {
  sport: 'worldcup' | 'golf';
  event: string;
  pick: string;
  betType: string;
  odds: string;
  confidence: 'High' | 'Medium' | 'Low';
  explanation: string;
  matchTime?: string;
}

export interface PickOption {
  pick: string;
  betType: string;
  odds: string;
  confidence: 'High' | 'Medium' | 'Low';
  explanation: string;
}

export interface MatchPick {
  event: string;
  matchTime?: string;
  highestPercent: PickOption;
}

export interface PicksResponse {
  worldcup: MatchPick[];
  golf: Pick[];
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

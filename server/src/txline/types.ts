export type TxLineScoreRow = {
  fixtureId?: number;
  FixtureId?: number;
  MessageId?: string;
  messageId?: string;
  gameState?: string;
  GameState?: string;
  ts?: number;
  Ts?: number;
  participant1IsHome?: boolean;
  Participant1IsHome?: boolean;
  scoreSoccer?: SoccerScoreBlock;
  Score?: SoccerScoreBlock;
};

type SoccerScoreBlock = {
  Participant1?: SoccerParticipantScore;
  Participant2?: SoccerParticipantScore;
};

type SoccerParticipantScore = {
  H1?: { Goals?: number };
  H2?: { Goals?: number };
  Total?: { Goals?: number };
};

export type FixtureStatus = "scheduled" | "live" | "finished";

export type OddtasyFixture = {
  FixtureId: number;
  fixtureId: number;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  StartTime: number;
  kickoffIso: string;
  CompetitionName?: string | undefined;
  CompetitionId?: number | undefined;
  competitionId: string;
  stage?: string | undefined;
  status: FixtureStatus;
  homeScore?: number | undefined;
  awayScore?: number | undefined;
  gameState?: string | undefined;
};

export type TxLineRawFixture = {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  StartTime: number;
  Competition?: string;
  CompetitionId?: number;
  FixtureGroupId?: number;
  Ts?: number;
};

export type TxLineOddsRow = {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  GameState?: string;
  InRunning: boolean;
  MarketParameters: string | null;
  MarketPeriod: string | null;
  PriceNames: string[];
  Prices: number[];
  Pct?: (number | string)[];
};

export type OddtasyOutcome = {
  key: string;
  label: string;
  rawPrice: number;
  decimalOdds: number;
  multiplier: number;
  impliedPct: number;
};

export type OddtasyMarket = {
  id: string;
  fixtureId: number;
  label: string;
  superOddsType: string;
  marketPeriod: string | null;
  marketParameters: string | null;
  inRunning: boolean;
  txLineMessageId: string;
  outcomes: OddtasyOutcome[];
};

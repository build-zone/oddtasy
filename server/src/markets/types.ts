export const MARKET = {
  MATCH_RESULT: 0,
  OVER_UNDER: 1,
  CORRECT_SCORE: 2,
  BTTS: 3,
  ODD_EVEN: 4,
} as const;

export type MarketType = (typeof MARKET)[keyof typeof MARKET];

export type PriceSource = "txline" | "model_fair" | "unpriced";

export type SocialOption = {
  prediction: number;
  key: string;
  label: string;
  probability?: number;
  decimalOdds?: number;
  impliedPct?: number;
  multiplier?: number;
  priceSource: PriceSource;
  txLineMessageId?: string;
};

export type SocialMarket = {
  marketType: MarketType;
  marketKey: "match_result" | "over_under" | "correct_score" | "btts" | "odd_even";
  label: string;
  marketParam: number;
  outcomeCount: number;
  options: SocialOption[];
  line?: number;
  correctScoreCap?: number;
  dataNote: string;
};

export type ModelInput = {
  homeLambda: number;
  awayLambda: number;
  rho?: number;
  correctScoreCap: number;
};

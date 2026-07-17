/**
 * DTOs mirrored from the Oddtasy server (server/src). The server is the
 * source of truth for these shapes — if they drift, fix them here, never
 * re-shape ad hoc inside components.
 */

/* ---- fixtures (server/src/txline/types.ts → loadOddtasyFixtures) ---- */
export type FixtureStatus = "scheduled" | "live" | "finished";

export type OddtasyFixture = {
  FixtureId: number;
  fixtureId: number;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  StartTime: number; // unix ms
  kickoffIso: string;
  CompetitionName?: string;
  CompetitionId?: number;
  competitionId: string; // slug: world-cup | int-friendlies | other
  stage?: string;
  status: FixtureStatus;
  homeScore?: number;
  awayScore?: number;
  gameState?: string;
};

export function homeTeam(f: OddtasyFixture): string {
  return f.Participant1IsHome ? f.Participant1 : f.Participant2;
}
export function awayTeam(f: OddtasyFixture): string {
  return f.Participant1IsHome ? f.Participant2 : f.Participant1;
}

/* ---- markets (server/src/markets/types.ts) ---- */
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
  marketType: number;
  marketKey: "match_result" | "over_under" | "correct_score" | "btts" | "odd_even";
  label: string;
  marketParam: number;
  outcomeCount: number;
  options: SocialOption[];
  line?: number;
  correctScoreCap?: number;
  dataNote: string;
};

export type SocialOptionsResponse = {
  fixtureId: number;
  source: string;
  correctScoreCap: number;
  socialMarkets: SocialMarket[];
};

/* ---- pools (server/src/pools/types.ts) ---- */
export type PoolStatus = "open" | "locked" | "resolved" | "voided" | "cancelled";
export type EntryStatus = "active" | "won" | "lost" | "refunded";

export type PoolRecord = {
  id: string;
  fixtureId: number;
  fixtureLabel: string;
  hostWallet: string;
  /** decorated by the server from the users store */
  hostName?: string | null;
  /**
   * How the requesting wallet did in this pool — only present on
   * GET /pools?wallet=…, and null when they never entered. The pool's own
   * status says the match settled; this says whether *you* won it.
   */
  viewer?: {
    status: EntryStatus;
    prediction: number;
    optionLabel: string | null;
    claimTxSignature: string | null;
  } | null;
  marketType: number;
  marketKey: string;
  marketParam: number;
  outcomeCount: number;
  optionLabel?: string;
  stakeUsdc: number;
  stakeAmount: number; // base units
  rakeBps: number;
  maxEntries: number;
  deadline: number; // unix seconds
  status: PoolStatus;
  entryCount: number;
  winningOutcome?: number;
  winnerCount?: number;
  shareAmount?: string;
  createTxSignature?: string;
  resolveTxSignature?: string;
  createdAt: string;
  updatedAt: string;
};

export type EntryRecord = {
  id: string;
  poolId: string;
  fixtureId: number;
  wallet: string;
  /** decorated by the server from the users store */
  displayName?: string | null;
  prediction: number;
  optionLabel: string;
  stakeUsdc: number;
  stakeAmount: number;
  status: EntryStatus;
  enterTxSignature?: string;
  claimTxSignature?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChainPdas = {
  programId: string;
  poolIdBytesHex: string;
  config: string;
  pool: string;
  vault: string;
  entry?: string;
} | null;

export type PoolWithChain = PoolRecord & { chain: ChainPdas };

export type InstructionEnvelope = {
  name: string;
  args: Record<string, unknown>;
};

export type CreatePoolResponse = {
  pool: PoolRecord;
  chain: ChainPdas;
  instruction: InstructionEnvelope;
  /** base64 unsigned tx — present once the server tx-builder ships (Pattern A) */
  transaction?: string;
};

export type PoolDetailResponse = {
  pool: PoolRecord;
  entries: EntryRecord[];
  chain: ChainPdas;
};

export type EnterPoolResponse = {
  entry: EntryRecord;
  pool: PoolRecord;
  chain: ChainPdas;
  instruction: InstructionEnvelope;
  transaction?: string;
};

export type ClaimTxResponse = {
  transaction: string;
  expiresAt: string;
  chain: ChainPdas;
};

/* ---- pool group chat (server/src/chat) ---- */
export type ChatMessage = {
  id: string;
  poolId: string;
  wallet: string;
  /** decorated by the server from the users store */
  displayName?: string | null;
  text: string;
  kind: "text" | "reaction";
  at: string;
};

/* ---- user profiles (server/src/users) ---- */
export type UserProfile = {
  wallet: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type HealthResponse = {
  ok: boolean;
  txlineConfigured: boolean;
  txlineApiOrigin: string;
  bettingProgramId: string | null;
  usdcMint: string | null;
  resolverConfigured: boolean;
  resolverModeReady: boolean;
  faucetConfigured: boolean;
};

/* ---- demo faucet (server/src/faucet) ---- */
export type FaucetResponse = {
  /** true when this call actually sent funds; false when already funded */
  funded: boolean;
  alreadyFunded: boolean;
  wallet?: string;
  signature?: string | null;
  usdc?: number | null;
  sol?: number | null;
};

/* ---- live score stream (raw TxLINE rows proxied by /stream/scores) ---- */
type ParticipantScore = { Goals?: number };
type ScoreBlock = {
  Participant1?: { Total?: ParticipantScore; H1?: ParticipantScore; H2?: ParticipantScore };
  Participant2?: { Total?: ParticipantScore; H1?: ParticipantScore; H2?: ParticipantScore };
};
export type ScoreStreamRow = {
  FixtureId?: number;
  fixtureId?: number;
  gameState?: string;
  GameState?: string;
  Score?: ScoreBlock;
  scoreSoccer?: ScoreBlock;
  ts?: number;
  Ts?: number;
};

export type LiveScore = {
  fixtureId: number;
  p1Goals: number | null;
  p2Goals: number | null;
  gameState: string;
  at: number;
};

/** Mirrors server normalize-fixtures extraction; participant order, not home/away. */
export function extractLiveScore(row: ScoreStreamRow): LiveScore | null {
  const fixtureId = row.FixtureId ?? row.fixtureId;
  if (fixtureId == null) return null;
  const block = row.Score ?? row.scoreSoccer;
  const goals = (p?: { Total?: ParticipantScore; H2?: ParticipantScore; H1?: ParticipantScore }) =>
    p?.Total?.Goals ?? p?.H2?.Goals ?? p?.H1?.Goals ?? null;
  return {
    fixtureId,
    p1Goals: goals(block?.Participant1),
    p2Goals: goals(block?.Participant2),
    gameState: (row.gameState ?? row.GameState ?? "").toUpperCase(),
    at: Date.now(),
  };
}

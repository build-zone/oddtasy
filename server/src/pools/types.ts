export type PoolStatus = "open" | "locked" | "resolved" | "voided" | "cancelled";
export type EntryStatus = "active" | "won" | "lost" | "refunded";

export type PoolRecord = {
  id: string;
  fixtureId: number;
  fixtureLabel: string;
  hostWallet: string;
  marketType: number;
  marketKey: string;
  marketParam: number;
  outcomeCount: number;
  optionLabel?: string | undefined;
  stakeUsdc: number;
  stakeAmount: number;
  rakeBps: number;
  maxEntries: number;
  deadline: number;
  status: PoolStatus;
  entryCount: number;
  winningOutcome?: number | undefined;
  winnerCount?: number | undefined;
  shareAmount?: string | undefined;
  createTxSignature?: string | undefined;
  resolveTxSignature?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type EntryRecord = {
  id: string;
  poolId: string;
  fixtureId: number;
  wallet: string;
  prediction: number;
  optionLabel: string;
  stakeUsdc: number;
  stakeAmount: number;
  status: EntryStatus;
  enterTxSignature?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type StoreData = {
  pools: PoolRecord[];
  entries: EntryRecord[];
};

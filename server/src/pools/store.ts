import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { broadcastPoolUpdate } from "../chat/hub.js";
import type { EntryRecord, EntryStatus, PoolRecord, PoolStatus, StoreData } from "./types.js";

const USDC_UNIT = 1_000_000;
let cache: StoreData | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function dataPath(): string {
  return path.resolve(process.cwd(), config.dataFile);
}

function emptyData(): StoreData {
  return { pools: [], entries: [] };
}

function readStore(): StoreData {
  if (cache) return cache;
  const file = dataPath();
  if (!fs.existsSync(file)) {
    cache = emptyData();
    return cache;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoreData;
  cache = {
    pools: Array.isArray(parsed.pools) ? parsed.pools : [],
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
  return cache;
}

function writeStore(data: StoreData): void {
  cache = data;
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function usdcToBaseUnits(value: number): number {
  return Math.round(value * USDC_UNIT);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export type CreatePoolInput = {
  id?: string | undefined;
  fixtureId: number;
  fixtureLabel: string;
  hostWallet: string;
  marketType: number;
  marketKey: string;
  marketParam: number;
  outcomeCount: number;
  optionLabel?: string | undefined;
  stakeUsdc?: number | undefined;
  rakeBps?: number | undefined;
  maxEntries?: number | undefined;
  deadline: number;
  createTxSignature?: string | undefined;
};

export function createPool(input: CreatePoolInput): PoolRecord {
  const data = readStore();
  const at = nowIso();
  const stakeUsdc = input.stakeUsdc ?? config.defaultStakeUsdc;
  const pool: PoolRecord = {
    id: input.id?.trim() || randomUUID(),
    fixtureId: input.fixtureId,
    fixtureLabel: input.fixtureLabel,
    hostWallet: input.hostWallet,
    marketType: input.marketType,
    marketKey: input.marketKey,
    marketParam: input.marketParam,
    outcomeCount: input.outcomeCount,
    optionLabel: input.optionLabel,
    stakeUsdc,
    stakeAmount: usdcToBaseUnits(stakeUsdc),
    rakeBps: input.rakeBps ?? config.defaultRakeBps,
    maxEntries: input.maxEntries ?? config.defaultMaxEntries,
    deadline: input.deadline,
    status: "open",
    entryCount: 0,
    createTxSignature: input.createTxSignature,
    createdAt: at,
    updatedAt: at,
  };

  data.pools.push(pool);
  writeStore(data);
  return clone(pool);
}

export function listPools(filters?: {
  fixtureId?: number | undefined;
  wallet?: string | undefined;
  status?: PoolStatus | undefined;
}): PoolRecord[] {
  const data = readStore();
  let pools = data.pools;
  if (filters?.fixtureId != null) pools = pools.filter((pool) => pool.fixtureId === filters.fixtureId);
  if (filters?.status) pools = pools.filter((pool) => pool.status === filters.status);
  if (filters?.wallet) {
    const wallet = filters.wallet;
    const poolIds = new Set(data.entries.filter((entry) => entry.wallet === wallet).map((entry) => entry.poolId));
    pools = pools.filter((pool) => pool.hostWallet === wallet || poolIds.has(pool.id));
  }
  return clone([...pools].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export function getPool(poolId: string): PoolRecord | undefined {
  const pool = readStore().pools.find((candidate) => candidate.id === poolId);
  return pool ? clone(pool) : undefined;
}

export function getPoolEntries(poolId: string): EntryRecord[] {
  return clone(readStore().entries.filter((entry) => entry.poolId === poolId));
}

export type CreateEntryInput = {
  wallet: string;
  prediction: number;
  optionLabel: string;
  enterTxSignature?: string | undefined;
};

export function createEntry(poolId: string, input: CreateEntryInput): EntryRecord {
  const data = readStore();
  const pool = data.pools.find((candidate) => candidate.id === poolId);
  if (!pool) throw new Error("Pool not found");
  if (pool.status !== "open") throw new Error("Pool is not open");
  if (Math.floor(Date.now() / 1000) >= pool.deadline) throw new Error("Pool entry deadline has passed");
  if (pool.entryCount >= pool.maxEntries) throw new Error("Pool is full");
  if (!Number.isInteger(input.prediction) || input.prediction < 0 || input.prediction >= pool.outcomeCount) {
    throw new Error("Prediction is out of range");
  }
  if (data.entries.some((entry) => entry.poolId === poolId && entry.wallet === input.wallet)) {
    throw new Error("Wallet has already entered this pool");
  }

  const at = nowIso();
  const entry: EntryRecord = {
    id: randomUUID(),
    poolId,
    fixtureId: pool.fixtureId,
    wallet: input.wallet,
    prediction: input.prediction,
    optionLabel: input.optionLabel,
    stakeUsdc: pool.stakeUsdc,
    stakeAmount: pool.stakeAmount,
    status: "active",
    enterTxSignature: input.enterTxSignature,
    createdAt: at,
    updatedAt: at,
  };

  data.entries.push(entry);
  pool.entryCount += 1;
  pool.updatedAt = at;
  writeStore(data);
  return clone(entry);
}

/** Records a confirmed on-chain signature reported back by the client. */
export function recordTxSignature(
  poolId: string,
  kind: "create" | "enter" | "claim" | "refund",
  signature: string,
  wallet?: string,
): boolean {
  const data = readStore();
  const pool = data.pools.find((p) => p.id === poolId);
  if (!pool) return false;
  const at = nowIso();
  if (kind === "create") {
    pool.createTxSignature = signature;
    pool.updatedAt = at;
    // hosting bundles the host's own bet into the same transaction
    const hostEntry = data.entries.find(
      (e) => e.poolId === poolId && e.wallet === pool.hostWallet && !e.enterTxSignature,
    );
    if (hostEntry) {
      hostEntry.enterTxSignature = signature;
      hostEntry.updatedAt = at;
    }
    writeStore(data);
    return true;
  }
  const entry = data.entries.find((e) => e.poolId === poolId && e.wallet === wallet);
  if (!entry) return false;
  if (kind === "enter") entry.enterTxSignature = signature;
  else entry.claimTxSignature = signature;
  entry.updatedAt = at;
  writeStore(data);
  return true;
}

export function finalizingPoolsForFixture(fixtureId: string | number): Promise<PoolRecord[]> {
  const id = Number(fixtureId);
  return Promise.resolve(
    clone(readStore().pools.filter((pool) => pool.fixtureId === id && ["open", "locked"].includes(pool.status))),
  );
}

function setPoolStatus(poolId: string, patch: Partial<PoolRecord>): PoolRecord | undefined {
  const data = readStore();
  const pool = data.pools.find((candidate) => candidate.id === poolId);
  if (!pool) return undefined;
  Object.assign(pool, patch, { updatedAt: nowIso() });
  writeStore(data);
  broadcastPoolUpdate(poolId, "status");
  return clone(pool);
}

export function markLocked(poolId: string): PoolRecord | undefined {
  return setPoolStatus(poolId, { status: "locked" });
}

export function markResolved(
  poolId: string,
  winningOutcome: number,
  winnerCount: number,
  shareAmount: string,
  txSig: string,
): Promise<void> {
  const data = readStore();
  const pool = data.pools.find((candidate) => candidate.id === poolId);
  if (!pool) return Promise.resolve();
  pool.status = "resolved";
  pool.winningOutcome = winningOutcome;
  pool.winnerCount = winnerCount;
  pool.shareAmount = shareAmount;
  pool.resolveTxSignature = txSig;
  pool.updatedAt = nowIso();
  updateEntryStatuses(data, poolId, (entry) => (entry.prediction === winningOutcome ? "won" : "lost"));
  writeStore(data);
  broadcastPoolUpdate(poolId, "status");
  return Promise.resolve();
}

export function markVoided(poolId: string, winningOutcome: number, txSig: string): Promise<void> {
  const data = readStore();
  const pool = data.pools.find((candidate) => candidate.id === poolId);
  if (!pool) return Promise.resolve();
  pool.status = "voided";
  pool.winningOutcome = winningOutcome;
  pool.winnerCount = 0;
  pool.resolveTxSignature = txSig;
  pool.updatedAt = nowIso();
  updateEntryStatuses(data, poolId, () => "refunded");
  writeStore(data);
  broadcastPoolUpdate(poolId, "status");
  return Promise.resolve();
}

export function markCancelled(poolId: string, txSig: string): Promise<void> {
  const data = readStore();
  const pool = data.pools.find((candidate) => candidate.id === poolId);
  if (!pool) return Promise.resolve();
  pool.status = "cancelled";
  pool.resolveTxSignature = txSig;
  pool.updatedAt = nowIso();
  updateEntryStatuses(data, poolId, () => "refunded");
  writeStore(data);
  broadcastPoolUpdate(poolId, "status");
  return Promise.resolve();
}

function updateEntryStatuses(
  data: StoreData,
  poolId: string,
  nextStatus: (entry: EntryRecord) => EntryStatus,
): void {
  const at = nowIso();
  for (const entry of data.entries) {
    if (entry.poolId !== poolId || entry.status !== "active") continue;
    entry.status = nextStatus(entry);
    entry.updatedAt = at;
  }
}

export function countLocalWinners(poolId: string, winningOutcome: number): { total: number; winners: number } {
  const entries = readStore().entries.filter((entry) => entry.poolId === poolId);
  return {
    total: entries.length,
    winners: entries.filter((entry) => entry.prediction === winningOutcome).length,
  };
}

export function syncTerminal(poolId: string, status: PoolStatus): Promise<void> {
  if (status === "resolved" || status === "voided" || status === "cancelled") {
    setPoolStatus(poolId, { status });
  }
  return Promise.resolve();
}

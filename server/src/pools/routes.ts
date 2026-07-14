import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { broadcastPoolUpdate } from "../chat/hub.js";
import { poolPdas } from "../chain/pdas.js";
import {
  buildClaimTx,
  buildCreatePoolTx,
  buildCreateWithEntryTx,
  buildEnterPoolTx,
} from "../chain/txbuilder.js";
import { displayNames } from "../users/store.js";
import {
  createEntry,
  createPool,
  getPool,
  getPoolEntries,
  listPools,
  recordTxSignature,
  type CreatePoolInput,
} from "./store.js";
import type { EntryRecord, PoolRecord } from "./types.js";

function decoratePool<T extends PoolRecord>(pool: T): T & { hostName: string | null } {
  const names = displayNames([pool.hostWallet]);
  return { ...pool, hostName: names[pool.hostWallet] ?? null };
}

function decorateEntries(entries: EntryRecord[]): (EntryRecord & { displayName: string | null })[] {
  const names = displayNames(entries.map((e) => e.wallet));
  return entries.map((e) => ({ ...e, displayName: names[e.wallet] ?? null }));
}

function isWallet(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 64;
}

function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseCreatePool(body: unknown): CreatePoolInput | string {
  if (!body || typeof body !== "object") return "Invalid request body";
  const input = body as Record<string, unknown>;
  if (!isWallet(input.hostWallet)) return "hostWallet is required";
  const fixtureId = num(input.fixtureId);
  if (fixtureId == null) return "fixtureId is required";
  if (typeof input.fixtureLabel !== "string" || !input.fixtureLabel.trim()) {
    return "fixtureLabel is required";
  }
  const marketType = num(input.marketType);
  const marketParam = num(input.marketParam);
  const outcomeCount = num(input.outcomeCount);
  const deadline = num(input.deadline);
  if (marketType == null) return "marketType is required";
  if (marketParam == null) return "marketParam is required";
  if (outcomeCount == null || outcomeCount < 2) return "outcomeCount must be at least 2";
  if (deadline == null || deadline <= Math.floor(Date.now() / 1000)) {
    return "deadline must be a future unix timestamp";
  }
  if (typeof input.marketKey !== "string" || !input.marketKey.trim()) return "marketKey is required";

  const stakeUsdc = input.stakeUsdc == null ? undefined : num(input.stakeUsdc);
  if (input.stakeUsdc != null && (stakeUsdc == null || stakeUsdc <= 0)) {
    return "stakeUsdc must be greater than 0";
  }
  const rakeBps = input.rakeBps == null ? undefined : num(input.rakeBps);
  if (input.rakeBps != null && (rakeBps == null || rakeBps < 0 || rakeBps > 1000)) {
    return "rakeBps must be between 0 and 1000";
  }
  const maxEntries = input.maxEntries == null ? undefined : num(input.maxEntries);
  if (input.maxEntries != null && (maxEntries == null || maxEntries < 2)) {
    return "maxEntries must be at least 2";
  }

  return {
    id: typeof input.id === "string" ? input.id.trim() : undefined,
    hostWallet: input.hostWallet.trim(),
    fixtureId,
    fixtureLabel: input.fixtureLabel.trim(),
    marketType,
    marketKey: input.marketKey.trim(),
    marketParam,
    outcomeCount,
    optionLabel: typeof input.optionLabel === "string" ? input.optionLabel.trim() : undefined,
    stakeUsdc: stakeUsdc ?? undefined,
    rakeBps: rakeBps ?? undefined,
    maxEntries: maxEntries ?? undefined,
    deadline,
    createTxSignature:
      typeof input.createTxSignature === "string" ? input.createTxSignature.trim() : undefined,
  };
}

export function createPoolRoutes(): Router {
  const router = createRouter();

  router.get("/", (req, res) => {
    const fixtureId = typeof req.query.fixtureId === "string" ? Number(req.query.fixtureId) : undefined;
    const wallet = typeof req.query.wallet === "string" ? req.query.wallet : undefined;
    const status =
      typeof req.query.status === "string" &&
      ["open", "locked", "resolved", "voided", "cancelled"].includes(req.query.status)
        ? (req.query.status as "open" | "locked" | "resolved" | "voided" | "cancelled")
        : undefined;

    res.json(
      listPools({
        fixtureId: Number.isFinite(fixtureId) ? fixtureId : undefined,
        wallet,
        status,
      }).map((pool) => ({ ...decoratePool(pool), chain: poolPdas(pool.id) })),
    );
  });

  router.post("/", async (req, res) => {
    const parsed = parseCreatePool(req.body);
    if (typeof parsed === "string") {
      res.status(400).json({ error: parsed });
      return;
    }

    try {
      const pool = createPool(parsed);
      // hosting includes the host's own bet: record their entry and bundle
      // create_pool + enter_pool into one transaction
      const hostPrediction = num((req.body as Record<string, unknown>).hostPrediction);
      if (hostPrediction != null) {
        createEntry(pool.id, {
          wallet: pool.hostWallet,
          prediction: hostPrediction,
          optionLabel: pool.optionLabel ?? `Prediction ${hostPrediction}`,
        });
      }
      const built =
        hostPrediction != null
          ? await buildCreateWithEntryTx(pool, hostPrediction)
          : await buildCreatePoolTx(pool);
      res.status(201).json({
        pool: getPool(pool.id) ?? pool,
        chain: poolPdas(pool.id),
        ...(built ?? {}),
        instruction: {
          name: "createPool",
          args: {
            poolId: pool.id,
            poolIdBytesHex: poolPdas(pool.id)?.poolIdBytesHex,
            marketType: pool.marketType,
            marketParam: pool.marketParam,
            outcomeCount: pool.outcomeCount,
            stakeAmount: pool.stakeAmount,
            rakeBps: pool.rakeBps,
            maxEntries: pool.maxEntries,
            deadline: pool.deadline,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create pool";
      res.status(500).json({ error: message });
    }
  });

  router.get("/:poolId", (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    res.json({
      pool: decoratePool(pool),
      entries: decorateEntries(getPoolEntries(pool.id)),
      chain: poolPdas(pool.id),
    });
  });

  router.get("/:poolId/chain", (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const member = typeof req.query.member === "string" ? req.query.member : undefined;
    res.json({ poolId: pool.id, chain: poolPdas(pool.id, member) });
  });

  router.post("/:poolId/entries", async (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (!isWallet(body?.wallet)) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }
    const prediction = num(body.prediction);
    if (prediction == null) {
      res.status(400).json({ error: "prediction is required" });
      return;
    }
    const optionLabel =
      typeof body.optionLabel === "string" && body.optionLabel.trim()
        ? body.optionLabel.trim()
        : `Prediction ${prediction}`;

    try {
      const entry = createEntry(pool.id, {
        wallet: body.wallet.trim(),
        prediction,
        optionLabel,
        enterTxSignature:
          typeof body.enterTxSignature === "string" ? body.enterTxSignature.trim() : undefined,
      });
      // only offer a transaction when the pool actually exists on-chain —
      // otherwise wallets pre-simulate a doomed tx and scare the user
      broadcastPoolUpdate(pool.id, "entry");
      const built = pool.createTxSignature
        ? await buildEnterPoolTx(pool.id, entry.wallet, prediction)
        : null;
      res.status(201).json({
        entry,
        pool: getPool(pool.id),
        chain: poolPdas(pool.id, entry.wallet),
        ...(built ?? {}),
        instruction: {
          name: "enterPool",
          args: {
            poolId: pool.id,
            poolIdBytesHex: poolPdas(pool.id)?.poolIdBytesHex,
            prediction,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to enter pool";
      res.status(400).json({ error: message });
    }
  });

  // build the payout transaction: claim (resolved) or refund (voided/cancelled)
  const claimHandler =
    (kind: "winnings" | "refund") => async (req: Request, res: Response) => {
      const pool = getPool(req.params.poolId as string);
      if (!pool) {
        res.status(404).json({ error: "Pool not found" });
        return;
      }
      const body = req.body as Record<string, unknown>;
      if (!isWallet(body?.wallet)) {
        res.status(400).json({ error: "wallet is required" });
        return;
      }
      const wallet = (body.wallet as string).trim();
      const entry = getPoolEntries(pool.id).find((e) => e.wallet === wallet);
      if (!entry) {
        res.status(403).json({ error: "No entry for this wallet" });
        return;
      }
      if (kind === "winnings" && pool.status !== "resolved") {
        res.status(409).json({ error: "Pool is not resolved yet" });
        return;
      }
      if (kind === "refund" && pool.status !== "voided" && pool.status !== "cancelled") {
        res.status(409).json({ error: "Pool is not refundable" });
        return;
      }
      if (!pool.createTxSignature) {
        res.status(409).json({ error: "Pool was never created on-chain" });
        return;
      }
      const built = await buildClaimTx(pool.id, wallet, kind);
      if (!built) {
        res.status(503).json({ error: "Chain not configured — cannot build transaction" });
        return;
      }
      res.json({ ...built, chain: poolPdas(pool.id, wallet) });
    };

  router.post("/:poolId/claim", claimHandler("winnings"));
  router.post("/:poolId/refund", claimHandler("refund"));

  // rebuild the create transaction for a pool recorded but never put on-chain
  router.post("/:poolId/create-tx", async (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const wallet = isWallet(body?.wallet) ? (body.wallet as string).trim() : "";
    if (wallet !== pool.hostWallet) {
      res.status(403).json({ error: "Only the host can create the pool on-chain" });
      return;
    }
    if (pool.createTxSignature) {
      res.status(409).json({ error: "Pool is already on-chain" });
      return;
    }
    if (pool.status !== "open" || Math.floor(Date.now() / 1000) >= pool.deadline) {
      res.status(409).json({ error: "Pool can no longer be created" });
      return;
    }
    const hostEntry = getPoolEntries(pool.id).find(
      (e) => e.wallet === pool.hostWallet && !e.enterTxSignature,
    );
    const built = hostEntry
      ? await buildCreateWithEntryTx(pool, hostEntry.prediction)
      : await buildCreatePoolTx(pool);
    if (!built) {
      res.status(503).json({ error: "Chain not configured — cannot build transaction" });
      return;
    }
    res.json({ ...built, chain: poolPdas(pool.id) });
  });

  // rebuild the payment transaction for an entry that was recorded but never
  // paid (user closed/failed the wallet approval)
  router.post("/:poolId/entries/tx", async (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (!isWallet(body?.wallet)) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }
    const wallet = (body.wallet as string).trim();
    const entry = getPoolEntries(pool.id).find((e) => e.wallet === wallet);
    if (!entry) {
      res.status(404).json({ error: "No entry for this wallet" });
      return;
    }
    if (entry.enterTxSignature) {
      res.status(409).json({ error: "Entry is already paid" });
      return;
    }
    if (pool.status !== "open") {
      res.status(409).json({ error: "Pool is no longer open" });
      return;
    }
    if (!pool.createTxSignature) {
      res.status(409).json({ error: "Pool was never created on-chain" });
      return;
    }
    const built = await buildEnterPoolTx(pool.id, wallet, entry.prediction);
    if (!built) {
      res.status(503).json({ error: "Chain not configured — cannot build transaction" });
      return;
    }
    res.json({ ...built, chain: poolPdas(pool.id, wallet) });
  });

  // client reports a confirmed signature so the record links to the explorer
  router.post("/:poolId/tx", (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const kind = body?.kind;
    const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
    if (kind !== "create" && kind !== "enter" && kind !== "claim" && kind !== "refund") {
      res.status(400).json({ error: "kind must be create|enter|claim|refund" });
      return;
    }
    if (!signature || signature.length < 32) {
      res.status(400).json({ error: "signature is required" });
      return;
    }
    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : undefined;
    if (kind !== "create" && !isWallet(wallet)) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }
    const ok = recordTxSignature(pool.id, kind, signature, wallet);
    if (!ok) {
      res.status(404).json({ error: "No matching record" });
      return;
    }
    broadcastPoolUpdate(pool.id, "payment");
    res.json({ ok: true });
  });

  return router;
}

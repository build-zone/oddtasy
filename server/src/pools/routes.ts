import type { Router } from "express";
import { Router as createRouter } from "express";
import { poolPdas } from "../chain/pdas.js";
import {
  createEntry,
  createPool,
  getPool,
  getPoolEntries,
  listPools,
  type CreatePoolInput,
} from "./store.js";

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
      }).map((pool) => ({ ...pool, chain: poolPdas(pool.id) })),
    );
  });

  router.post("/", (req, res) => {
    const parsed = parseCreatePool(req.body);
    if (typeof parsed === "string") {
      res.status(400).json({ error: parsed });
      return;
    }

    try {
      const pool = createPool(parsed);
      res.status(201).json({
        pool,
        chain: poolPdas(pool.id),
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
    res.json({ pool, entries: getPoolEntries(pool.id), chain: poolPdas(pool.id) });
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

  router.post("/:poolId/entries", (req, res) => {
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
      res.status(201).json({
        entry,
        pool: getPool(pool.id),
        chain: poolPdas(pool.id, entry.wallet),
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

  return router;
}

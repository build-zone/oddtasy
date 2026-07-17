import type { Router } from "express";
import { Router as createRouter } from "express";
import { faucetAddress, faucetConfigured, sendFaucetFunds } from "../chain/faucet.js";
import { getClaim, recordClaim } from "./store.js";

function isWallet(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 64;
}

// wallets with a transfer in flight — guards against a double-fired client
// claiming twice before the first write lands
const inFlight = new Set<string>();

export function createFaucetRoutes(): Router {
  const router = createRouter();

  // Status: has this wallet already been funded, and is the faucet even on?
  router.get("/:wallet", (req, res) => {
    if (!isWallet(req.params.wallet)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    const claim = getClaim(req.params.wallet);
    res.json({
      configured: faucetConfigured(),
      faucetAddress: faucetAddress(),
      funded: Boolean(claim),
      usdc: claim?.usdc ?? null,
      sol: claim?.sol ?? null,
      signature: claim?.signature ?? null,
    });
  });

  // Fund a wallet once. Idempotent per wallet: a second call returns the
  // existing claim instead of sending more funds.
  router.post("/", async (req, res) => {
    const wallet = (req.body ?? {}).wallet;
    if (!isWallet(wallet)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    if (!faucetConfigured()) {
      res.status(503).json({ error: "Faucet is not configured on this server" });
      return;
    }

    const existing = getClaim(wallet);
    if (existing) {
      res.json({ funded: false, alreadyFunded: true, ...existing });
      return;
    }
    if (inFlight.has(wallet)) {
      res.status(409).json({ error: "A funding request for this wallet is already in progress" });
      return;
    }

    inFlight.add(wallet);
    try {
      // re-check inside the lock in case a concurrent request just recorded
      const raced = getClaim(wallet);
      if (raced) {
        res.json({ funded: false, alreadyFunded: true, ...raced });
        return;
      }
      const result = await sendFaucetFunds(wallet);
      recordClaim({ wallet, ...result, at: new Date().toISOString() });
      res.json({ funded: true, alreadyFunded: false, wallet, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Faucet transfer failed";
      console.warn("[faucet] failed to fund", wallet, "-", message);
      res.status(502).json({ error: message });
    } finally {
      inFlight.delete(wallet);
    }
  });

  return router;
}

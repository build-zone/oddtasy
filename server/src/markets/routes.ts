import type { Router } from "express";
import { Router as createRouter } from "express";
import { config } from "../config.js";
import { fetchOddsSnapshot } from "../txline/client.js";
import { normalizeMarkets } from "../txline/normalize-markets.js";
import { blankSocialMarkets, ranktasySocialMarkets, txlineSocialMarkets } from "./engine.js";

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createMarketRoutes(): Router {
  const router = createRouter({ mergeParams: true });

  router.get("/markets", async (req, res) => {
    const fixtureId = Number((req.params as { fixtureId?: string }).fixtureId);
    if (!Number.isFinite(fixtureId)) {
      res.status(400).json({ error: "Invalid fixture id" });
      return;
    }

    try {
      const rows = await fetchOddsSnapshot(fixtureId);
      res.json(normalizeMarkets(rows));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load markets";
      res.status(503).json({ error: message });
    }
  });

  router.get("/social-options", async (req, res) => {
    const fixtureId = Number((req.params as { fixtureId?: string }).fixtureId);
    if (!Number.isFinite(fixtureId)) {
      res.status(400).json({ error: "Invalid fixture id" });
      return;
    }

    const homeLambda = optionalNumber(req.query.homeLambda);
    const awayLambda = optionalNumber(req.query.awayLambda);
    const rho = optionalNumber(req.query.rho);
    const cap = optionalNumber(req.query.correctScoreCap) ?? config.correctScoreCap;
    const source =
      typeof req.query.source === "string" ? req.query.source.toLowerCase() : "hybrid";

    try {
      const txlineMarkets =
        source === "ranktasy" ? [] : txlineSocialMarkets(normalizeMarkets(await fetchOddsSnapshot(fixtureId)), cap);
      const modelMarkets =
        homeLambda != null && awayLambda != null
          ? ranktasySocialMarkets(
              rho == null
                ? { homeLambda, awayLambda, correctScoreCap: cap }
                : { homeLambda, awayLambda, rho, correctScoreCap: cap },
            )
          : [];

      let socialMarkets = txlineMarkets;
      if (source === "ranktasy") socialMarkets = modelMarkets;
      if (source === "hybrid") {
        const hasTxlineKeys = new Set(txlineMarkets.map((m) => `${m.marketKey}:${m.marketParam}`));
        socialMarkets = [
          ...txlineMarkets,
          ...modelMarkets.filter((m) => !hasTxlineKeys.has(`${m.marketKey}:${m.marketParam}`)),
        ];
      }
      if (socialMarkets.length === 0) socialMarkets = blankSocialMarkets(cap);

      res.json({
        fixtureId,
        source,
        correctScoreCap: cap,
        socialMarkets,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build social options";
      res.status(503).json({ error: message });
    }
  });

  return router;
}

import cors from "cors";
import express from "express";
import { assertTxLineConfigured, config } from "./config.js";
import { fetchOddsSnapshot } from "./txline/client.js";
import { loadOddtasyFixtures } from "./txline/normalize-fixtures.js";
import { normalizeMarkets } from "./txline/normalize-markets.js";
import { attachOddsStream, attachScoresStream } from "./stream/hub.js";
import { createMarketRoutes } from "./markets/routes.js";
import { createPoolRoutes } from "./pools/routes.js";
import { createChatRoutes } from "./chat/routes.js";
import { createUserRoutes } from "./users/routes.js";
import { attachChatStream } from "./chat/hub.js";
import { getPool } from "./pools/store.js";
import { createPoolProgramFromEnv, startSettlementWorker } from "./settlement/worker.js";

const app = express();

app.use(
  cors({
    origin: config.corsOrigin,
  }),
);
app.use(express.json());

let fixturesCache: { at: number; data: Awaited<ReturnType<typeof loadOddtasyFixtures>> } | null =
  null;

async function getFixturesCached() {
  const now = Date.now();
  if (fixturesCache && now - fixturesCache.at < config.fixturesCacheMs) {
    return fixturesCache.data;
  }
  const data = await loadOddtasyFixtures();
  fixturesCache = { at: now, data };
  return data;
}

function parseFixtureId(raw: string): number | null {
  const fixtureId = Number(raw);
  return Number.isFinite(fixtureId) ? fixtureId : null;
}

app.get("/health", (_req, res) => {
  const resolverConfigured = Boolean(process.env.ODDTASY_RESOLVER_KEY || process.env.ODDTASY_RESOLVER_KEYPAIR);
  res.json({
    ok: true,
    txlineConfigured: Boolean(config.txlineApiToken),
    txlineApiOrigin: config.txlineApiOrigin,
    bettingProgramId: config.bettingProgramId || null,
    usdcMint: config.usdcMint || null,
    resolverConfigured,
    resolverModeReady: resolverConfigured && Boolean(config.programIdlPath),
  });
});

app.get("/fixtures", async (_req, res) => {
  try {
    assertTxLineConfigured();
    res.json(await getFixturesCached());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load fixtures";
    res.status(503).json({ error: message });
  }
});

app.get("/fixtures/:fixtureId/odds", async (req, res) => {
  try {
    assertTxLineConfigured();
    const fixtureId = parseFixtureId(req.params.fixtureId);
    if (fixtureId == null) {
      res.status(400).json({ error: "Invalid fixture id" });
      return;
    }
    res.json(await fetchOddsSnapshot(fixtureId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load odds";
    res.status(503).json({ error: message });
  }
});

app.get("/fixtures/:fixtureId/normalized-markets", async (req, res) => {
  try {
    assertTxLineConfigured();
    const fixtureId = parseFixtureId(req.params.fixtureId);
    if (fixtureId == null) {
      res.status(400).json({ error: "Invalid fixture id" });
      return;
    }
    res.json(normalizeMarkets(await fetchOddsSnapshot(fixtureId)));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load markets";
    res.status(503).json({ error: message });
  }
});

app.use("/fixtures/:fixtureId", createMarketRoutes());
app.use("/pools", createPoolRoutes());
app.use("/pools", createChatRoutes());
app.use("/users", createUserRoutes());

// pool group chat — no TxLINE dependency, works even without an API token
app.get("/stream/chat", (req, res) => {
  const poolId = typeof req.query.poolId === "string" ? req.query.poolId : "";
  if (!poolId || !getPool(poolId)) {
    res.status(404).json({ error: "Pool not found" });
    return;
  }
  attachChatStream(res, poolId);
});

app.get("/stream/odds", (req, res) => {
  try {
    assertTxLineConfigured();
    const fixtureId = req.query.fixtureId ? Number(req.query.fixtureId) : undefined;
    if (req.query.fixtureId != null && !Number.isFinite(fixtureId)) {
      res.status(400).json({ error: "Invalid fixture id" });
      return;
    }
    attachOddsStream(res, fixtureId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream unavailable";
    res.status(503).json({ error: message });
  }
});

app.get("/stream/scores", (req, res) => {
  try {
    assertTxLineConfigured();
    const fixtureId = req.query.fixtureId ? Number(req.query.fixtureId) : undefined;
    if (req.query.fixtureId != null && !Number.isFinite(fixtureId)) {
      res.status(400).json({ error: "Invalid fixture id" });
      return;
    }
    attachScoresStream(res, fixtureId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream unavailable";
    res.status(503).json({ error: message });
  }
});

app.listen(config.port, () => {
  console.log(`Oddtasy API listening on http://localhost:${config.port}`);
  if (!config.txlineApiToken) {
    console.warn("Warning: TXLINE_API_TOKEN is missing; odds and streams will return 503.");
    return;
  }

  try {
    assertTxLineConfigured();
    const program = createPoolProgramFromEnv();
    startSettlementWorker(program);
  } catch (err) {
    console.warn("Settlement worker not started:", err instanceof Error ? err.message : err);
  }
});

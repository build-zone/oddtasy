/**
 * Real TxLINE integration e2e for the Oddtasy API.
 *
 * Unlike a smoke test, this fails unless live feed data is present and coherent:
 * fixtures have required fields, at least one tradeable fixture has priced odds,
 * normalized markets match StablePrice math, and social-options carry txline prices.
 *
 * Usage:
 *   npm run test:e2e
 *   BASE_URL=http://localhost:4100 npm run test:e2e
 */
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4100").replace(/\/$/, "");
const STREAM_WAIT_MS = Number(process.env.E2E_STREAM_WAIT_MS ?? 20_000);
const ODDS_SCAN_LIMIT = Number(process.env.E2E_ODDS_SCAN_LIMIT ?? 20);
const HOST_WALLET = "So11111111111111111111111111111111111111112";
const GUEST_WALLET = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const HOUSE_EDGE = 0.02;

type CheckResult = { name: string; ok: boolean; detail: string; ms: number };
type Fixture = {
  FixtureId: number;
  fixtureId: number;
  Participant1: string;
  Participant2: string;
  StartTime: number;
  kickoffIso: string;
  status: string;
  competitionId?: string;
};
type OddsRow = {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  SuperOddsType: string;
  MarketPeriod: string | null;
  MarketParameters: string | null;
  PriceNames: string[];
  Prices: number[];
  Pct?: (number | string)[];
  InRunning: boolean;
};
type Market = {
  id: string;
  fixtureId: number;
  label: string;
  superOddsType: string;
  marketPeriod: string | null;
  marketParameters: string | null;
  txLineMessageId: string;
  outcomes: Array<{
    key: string;
    label: string;
    rawPrice: number;
    decimalOdds: number;
    multiplier: number;
    impliedPct: number;
  }>;
};
type SocialOption = {
  prediction: number;
  key: string;
  label: string;
  decimalOdds?: number;
  multiplier?: number;
  priceSource: string;
  txLineMessageId?: string;
};
type SocialMarket = {
  marketType: number;
  marketKey: string;
  marketParam: number;
  outcomeCount: number;
  options: SocialOption[];
  line?: number;
};

const results: CheckResult[] = [];

function pass(name: string, detail: string, ms: number): void {
  results.push({ name, ok: true, detail, ms });
  console.log(`  PASS  ${name} (${ms}ms) — ${detail}`);
}

function fail(name: string, detail: string, ms: number): void {
  results.push({ name, ok: false, detail, ms });
  console.error(`  FAIL  ${name} (${ms}ms) — ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body == null ? undefined : { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, ms: Date.now() - started };
}

function almostEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function isFullTimePeriod(period: string | null | undefined): boolean {
  const value = String(period ?? "")
    .trim()
    .toUpperCase();
  return !value || value === "FT" || value === "NULL" || value === "FULLTIME" || value === "FULL_TIME";
}

function marketKey(row: OddsRow): string {
  return `${row.SuperOddsType}|${row.MarketPeriod ?? "null"}|${row.MarketParameters ?? "null"}`;
}

function expectedImpliedPct(pct: number | string | undefined, decimalOdds: number): number {
  const parsed = typeof pct === "number" ? pct : typeof pct === "string" ? parseFloat(pct) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed > 1 ? parsed / 100 : parsed;
  return decimalOdds > 0 ? 1 / decimalOdds : 0;
}

function validateOddsRow(row: OddsRow): string | null {
  if (!Number.isFinite(row.FixtureId)) return "missing FixtureId";
  if (typeof row.MessageId !== "string" || !row.MessageId.trim()) return "missing MessageId";
  if (typeof row.SuperOddsType !== "string" || !row.SuperOddsType.trim()) return "missing SuperOddsType";
  if (!Array.isArray(row.PriceNames) || !Array.isArray(row.Prices)) return "PriceNames/Prices not arrays";
  if (row.PriceNames.length === 0) return "empty PriceNames";
  if (row.PriceNames.length !== row.Prices.length) {
    return `PriceNames(${row.PriceNames.length}) != Prices(${row.Prices.length})`;
  }
  if (!row.Prices.every((p) => typeof p === "number" && p > 0)) return "non-positive Prices";
  return null;
}

async function readSseSample(
  path: string,
  waitMs: number,
): Promise<{ status: number; contentType: string; chunks: string; ms: number; error?: string }> {
  const started = Date.now();
  const url = new URL(path, BASE_URL);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const req = transport.get(
      url,
      {
        headers: { accept: "text/event-stream", connection: "keep-alive" },
      },
      (res) => {
        const contentType = String(res.headers["content-type"] ?? "");
        let chunks = "";
        let settled = false;

        const finish = (error?: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          res.removeAllListeners("data");
          req.destroy();
          resolve({
            status: res.statusCode ?? 0,
            contentType,
            chunks,
            ms: Date.now() - started,
            error,
          });
        };

        const timer = setTimeout(() => finish(), waitMs);

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          chunks += chunk;
          // A usable SSE frame needs a data payload (heartbeats are `event` + `data`).
          if (/\ndata:\s*\S/.test(`\n${chunks}`) || /^data:\s*\S/m.test(chunks)) finish();
        });
        res.on("end", () => finish());
        res.on("error", (err) => finish(err.message));
      },
    );

    req.on("error", (err) => {
      resolve({
        status: 0,
        contentType: "",
        chunks: "",
        ms: Date.now() - started,
        error: err.message,
      });
    });
  });
}

async function checkHealth(): Promise<boolean> {
  const name = "GET /health (TxLINE ready)";
  const res = await request("GET", "/health");
  const body = asRecord(res.json);
  if (res.status !== 200 || body?.ok !== true) {
    fail(name, `bad health: ${res.text.slice(0, 200)}`, res.ms);
    return false;
  }
  if (body.txlineConfigured !== true) {
    fail(name, "txlineConfigured must be true for integration e2e", res.ms);
    return false;
  }
  pass(name, `origin=${body.txlineApiOrigin}`, res.ms);
  return true;
}

async function checkFixtures(): Promise<Fixture[]> {
  const name = "GET /fixtures (shape + coverage)";
  const res = await request("GET", "/fixtures");
  if (res.status !== 200 || !Array.isArray(res.json) || res.json.length === 0) {
    fail(name, `expected non-empty array, got ${res.status}: ${res.text.slice(0, 200)}`, res.ms);
    return [];
  }

  const fixtures = res.json as Fixture[];
  const bad = fixtures.find((f) => {
    return (
      !Number.isFinite(f.FixtureId) ||
      f.fixtureId !== f.FixtureId ||
      typeof f.Participant1 !== "string" ||
      typeof f.Participant2 !== "string" ||
      !Number.isFinite(f.StartTime) ||
      typeof f.kickoffIso !== "string" ||
      new Date(f.kickoffIso).getTime() !== f.StartTime ||
      !["scheduled", "live", "finished"].includes(f.status)
    );
  });
  if (bad) {
    fail(name, `invalid fixture shape: ${JSON.stringify(bad).slice(0, 240)}`, res.ms);
    return [];
  }

  const tradeable = fixtures.filter((f) => f.status === "scheduled" || f.status === "live").length;
  pass(
    name,
    `${fixtures.length} fixtures (${tradeable} scheduled/live); sample=${fixtures[0]!.Participant1} vs ${fixtures[0]!.Participant2}`,
    res.ms,
  );
  return fixtures;
}

async function findPricedFixture(fixtures: Fixture[]): Promise<{
  fixture: Fixture;
  odds: OddsRow[];
} | null> {
  const name = "probe TxLINE odds on tradeable fixtures";
  const started = Date.now();
  const ordered = [
    ...fixtures.filter((f) => f.status === "live"),
    ...fixtures.filter((f) => f.status === "scheduled"),
    ...fixtures.filter((f) => f.status === "finished"),
  ];

  let scanned = 0;
  for (const fixture of ordered.slice(0, ODDS_SCAN_LIMIT)) {
    scanned += 1;
    const res = await request("GET", `/fixtures/${fixture.fixtureId}/odds`);
    if (res.status !== 200 || !Array.isArray(res.json)) continue;
    const odds = res.json as OddsRow[];
    if (odds.length === 0) continue;
    const invalid = odds.map(validateOddsRow).find((err) => err != null);
    if (invalid) {
      fail(name, `fixture ${fixture.fixtureId} has malformed odds: ${invalid}`, Date.now() - started);
      return null;
    }
    const has1x2 = odds.some((row) => row.SuperOddsType.toUpperCase().includes("1X2"));
    pass(
      name,
      `${fixture.Participant1} vs ${fixture.Participant2} (#${fixture.fixtureId}) rows=${odds.length} 1x2=${has1x2} scanned=${scanned}`,
      Date.now() - started,
    );
    return { fixture, odds };
  }

  fail(
    name,
    `no priced odds in first ${scanned} fixtures (need live TxLINE book for integration)`,
    Date.now() - started,
  );
  return null;
}

async function checkRawOdds(fixture: Fixture, odds: OddsRow[]): Promise<OddsRow> {
  const name = `GET /fixtures/${fixture.fixtureId}/odds (priced book)`;
  const started = Date.now();
  const ft1x2 =
    odds.find(
      (row) =>
        row.SuperOddsType.toUpperCase().includes("1X2") && isFullTimePeriod(row.MarketPeriod),
    ) ?? odds.find((row) => row.SuperOddsType.toUpperCase().includes("1X2")) ?? odds[0]!;

  const err = validateOddsRow(ft1x2);
  if (err) {
    fail(name, err, Date.now() - started);
    return ft1x2;
  }

  const decimals = ft1x2.Prices.map((p) => p / 1000);
  pass(
    name,
    `${ft1x2.SuperOddsType} period=${ft1x2.MarketPeriod ?? "null"} names=${ft1x2.PriceNames.join("/")} odds=${decimals.map((d) => d.toFixed(3)).join("/")} msg=${ft1x2.MessageId}`,
    Date.now() - started,
  );
  return ft1x2;
}

async function checkNormalizedMarkets(fixture: Fixture, odds: OddsRow[]): Promise<Market[]> {
  const paths = [
    `/fixtures/${fixture.fixtureId}/markets`,
    `/fixtures/${fixture.fixtureId}/normalized-markets`,
  ];
  let markets: Market[] = [];

  for (const path of paths) {
    const name = `GET ${path} (math vs StablePrice)`;
    const res = await request("GET", path);
    if (res.status !== 200 || !Array.isArray(res.json) || res.json.length === 0) {
      fail(name, `expected non-empty markets, got ${res.status}: ${res.text.slice(0, 200)}`, res.ms);
      continue;
    }
    markets = res.json as Market[];

    const byKey = new Map<string, OddsRow>();
    for (const row of odds) {
      const key = marketKey(row);
      const existing = byKey.get(key);
      if (!existing || row.Ts >= existing.Ts) byKey.set(key, row);
    }

    let checked = 0;
    for (const market of markets) {
      const row = byKey.get(market.id);
      if (!row) {
        fail(name, `market id ${market.id} missing from odds dedupe set`, res.ms);
        return markets;
      }
      if (market.fixtureId !== fixture.fixtureId) {
        fail(name, `fixtureId mismatch on ${market.id}`, res.ms);
        return markets;
      }
      if (market.txLineMessageId !== row.MessageId) {
        fail(name, `MessageId mismatch on ${market.id}`, res.ms);
        return markets;
      }
      if (market.outcomes.length !== row.PriceNames.length) {
        fail(name, `outcome count mismatch on ${market.id}`, res.ms);
        return markets;
      }
      for (let i = 0; i < market.outcomes.length; i++) {
        const outcome = market.outcomes[i]!;
        const raw = row.Prices[i]!;
        const decimalOdds = raw / 1000;
        const implied = expectedImpliedPct(row.Pct?.[i], decimalOdds);
        const multiplier = Number(((1 / implied) * (1 - HOUSE_EDGE)).toFixed(2));
        if (outcome.key !== row.PriceNames[i]) {
          fail(name, `outcome key mismatch on ${market.id}[${i}]`, res.ms);
          return markets;
        }
        if (outcome.rawPrice !== raw || !almostEqual(outcome.decimalOdds, decimalOdds)) {
          fail(
            name,
            `price math mismatch on ${market.id}[${i}]: raw=${outcome.rawPrice} decimal=${outcome.decimalOdds} expected=${decimalOdds}`,
            res.ms,
          );
          return markets;
        }
        if (!almostEqual(outcome.impliedPct, implied, 1e-6)) {
          fail(
            name,
            `impliedPct mismatch on ${market.id}[${i}]: got=${outcome.impliedPct} expected=${implied}`,
            res.ms,
          );
          return markets;
        }
        if (outcome.multiplier !== multiplier) {
          fail(
            name,
            `multiplier mismatch on ${market.id}[${i}]: got=${outcome.multiplier} expected=${multiplier}`,
            res.ms,
          );
          return markets;
        }
        checked += 1;
      }
    }

    pass(name, `${markets.length} markets, ${checked} outcomes verified against Odds snapshot`, res.ms);
  }

  return markets;
}

async function checkSocialOptions(fixture: Fixture, odds: OddsRow[]): Promise<SocialMarket[]> {
  const name = `GET /fixtures/${fixture.fixtureId}/social-options?source=txline`;
  const res = await request("GET", `/fixtures/${fixture.fixtureId}/social-options?source=txline`);
  const body = asRecord(res.json);
  if (res.status !== 200 || !body || !Array.isArray(body.socialMarkets)) {
    fail(name, `bad response ${res.status}: ${res.text.slice(0, 240)}`, res.ms);
    return [];
  }

  const socialMarkets = body.socialMarkets as SocialMarket[];
  const matchResult = socialMarkets.find((m) => m.marketKey === "match_result");
  const hasFt1x2 = odds.some(
    (row) => row.SuperOddsType.toUpperCase().includes("1X2") && isFullTimePeriod(row.MarketPeriod),
  );

  if (hasFt1x2) {
    if (!matchResult || matchResult.options.length !== 3) {
      fail(name, "expected priced match_result with 3 options from FT 1X2 feed", res.ms);
      return socialMarkets;
    }
    const unpriced = matchResult.options.filter((o) => o.priceSource !== "txline");
    if (unpriced.length) {
      fail(name, `match_result still unpriced: ${JSON.stringify(unpriced)}`, res.ms);
      return socialMarkets;
    }
    for (const option of matchResult.options) {
      if (!(typeof option.decimalOdds === "number" && option.decimalOdds > 1)) {
        fail(name, `bad decimalOdds on prediction ${option.prediction}`, res.ms);
        return socialMarkets;
      }
      if (typeof option.txLineMessageId !== "string" || !option.txLineMessageId) {
        fail(name, `missing txLineMessageId on prediction ${option.prediction}`, res.ms);
        return socialMarkets;
      }
    }
    const preds = matchResult.options.map((o) => o.prediction).join(",");
    if (preds !== "0,1,2") {
      fail(name, `predictions should be 0,1,2 got ${preds}`, res.ms);
      return socialMarkets;
    }
  }

  const overUnders = socialMarkets.filter((m) => m.marketKey === "over_under");
  const hasFtOu = odds.some(
    (row) =>
      row.SuperOddsType.toUpperCase().includes("OVERUNDER") && isFullTimePeriod(row.MarketPeriod),
  );
  if (hasFtOu && overUnders.length === 0) {
    fail(name, "FT over/under present in odds but missing from social-options", res.ms);
    return socialMarkets;
  }
  for (const market of overUnders) {
    if (market.options.some((o) => o.priceSource !== "txline")) {
      fail(name, `over_under ${market.marketParam} not fully txline-priced`, res.ms);
      return socialMarkets;
    }
    if (market.options.length !== 2) {
      fail(name, `over_under ${market.marketParam} should have 2 options`, res.ms);
      return socialMarkets;
    }
  }

  pass(
    name,
    `markets=${socialMarkets.map((m) => m.marketKey).join(",")} matchOdds=${matchResult?.options.map((o) => o.decimalOdds?.toFixed(3)).join("/") ?? "n/a"} ou=${overUnders.length}`,
    res.ms,
  );

  // Model path should still produce model-priced grids without TxLINE.
  {
    const modelName = `GET /fixtures/${fixture.fixtureId}/social-options?source=model`;
    const modelRes = await request(
      "GET",
      `/fixtures/${fixture.fixtureId}/social-options?source=model&homeLambda=1.4&awayLambda=1.1&rho=0.05`,
    );
    const modelBody = asRecord(modelRes.json);
    const modelMarkets = Array.isArray(modelBody?.socialMarkets)
      ? (modelBody.socialMarkets as SocialMarket[])
      : [];
    const modelMatch = modelMarkets.find((m) => m.marketKey === "match_result");
    if (
      modelRes.status !== 200 ||
      !modelMatch ||
      modelMatch.options.some((o) => o.priceSource !== "model_fair" || !(o.decimalOdds! > 1))
    ) {
      fail(modelName, `expected model_fair 1X2, got ${modelRes.text.slice(0, 200)}`, modelRes.ms);
    } else {
      pass(
        modelName,
        `model odds=${modelMatch.options.map((o) => o.decimalOdds?.toFixed(2)).join("/")}`,
        modelRes.ms,
      );
    }
  }

  return socialMarkets;
}

async function checkPoolsFlow(fixture: Fixture, socialMarkets: SocialMarket[]): Promise<void> {
  const match =
    socialMarkets.find((m) => m.marketKey === "match_result" && m.options.every((o) => o.priceSource === "txline")) ??
    socialMarkets.find((m) => m.marketKey === "match_result");
  if (!match) {
    fail("POST /pools (from live social market)", "no match_result social market to bind", 0);
    return;
  }

  const poolId = randomUUID();
  const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
  const createName = "POST /pools (bound to live TxLINE market)";
  const create = await request("POST", "/pools", {
    id: poolId,
    hostWallet: HOST_WALLET,
    fixtureId: fixture.fixtureId,
    fixtureLabel: `${fixture.Participant1} vs ${fixture.Participant2}`,
    marketType: match.marketType,
    marketKey: match.marketKey,
    marketParam: match.marketParam,
    outcomeCount: match.outcomeCount,
    optionLabel: match.options.map((o) => o.label).join(" / "),
    stakeUsdc: 5,
    rakeBps: 500,
    maxEntries: 10,
    deadline,
  });
  const created = asRecord(asRecord(create.json)?.pool);
  if (create.status !== 201 || created?.id !== poolId) {
    fail(createName, `create failed: ${create.text.slice(0, 240)}`, create.ms);
    return;
  }
  pass(
    createName,
    `pool=${poolId} market=${match.marketKey} odds=${match.options.map((o) => o.decimalOdds?.toFixed(2)).join("/")}`,
    create.ms,
  );

  const pick = match.options[0]!;
  const enterName = `POST /pools/${poolId}/entries (prediction ${pick.prediction})`;
  const enter = await request("POST", `/pools/${poolId}/entries`, {
    wallet: GUEST_WALLET,
    prediction: pick.prediction,
    optionLabel: pick.label,
  });
  const entry = asRecord(asRecord(enter.json)?.entry);
  if (enter.status !== 201 || entry?.prediction !== pick.prediction) {
    fail(enterName, `enter failed: ${enter.text.slice(0, 240)}`, enter.ms);
    return;
  }
  pass(enterName, `entry=${entry.id} label=${pick.label} decimalOdds=${pick.decimalOdds}`, enter.ms);

  const getName = `GET /pools/${poolId}`;
  const got = await request("GET", `/pools/${poolId}`);
  const body = asRecord(got.json);
  if (
    got.status !== 200 ||
    asRecord(body?.pool)?.fixtureId !== fixture.fixtureId ||
    !Array.isArray(body?.entries) ||
    (body.entries as unknown[]).length !== 1
  ) {
    fail(getName, `unexpected pool payload: ${got.text.slice(0, 240)}`, got.ms);
    return;
  }
  pass(getName, `fixtureId=${fixture.fixtureId} entries=1`, got.ms);
}

async function checkStreams(fixtureId: number): Promise<void> {
  for (const kind of ["odds", "scores"] as const) {
    const name = `GET /stream/${kind} (SSE payload)`;
    const sample = await readSseSample(`/stream/${kind}?fixtureId=${fixtureId}`, STREAM_WAIT_MS);
    if (sample.status !== 200 || !sample.contentType.includes("text/event-stream")) {
      fail(
        name,
        `status=${sample.status} type=${sample.contentType} ${sample.error ?? sample.chunks.slice(0, 120)}`,
        sample.ms,
      );
      continue;
    }
    if (!/data:\s*\S/.test(sample.chunks)) {
      fail(name, `connected but no SSE data payload within ${STREAM_WAIT_MS}ms`, sample.ms);
      continue;
    }
    pass(name, `got ${sample.chunks.trim().split("\n").slice(0, 2).join(" | ")} (${sample.chunks.length} chars)`, sample.ms);
  }
}

async function checkNegatives(): Promise<void> {
  const invalid = await request("GET", "/fixtures/not-a-number/odds");
  if (invalid.status !== 400) fail("invalid fixture id → 400", `got ${invalid.status}`, invalid.ms);
  else pass("invalid fixture id → 400", "rejected", invalid.ms);

  const missing = await request("GET", `/pools/${randomUUID()}`);
  if (missing.status !== 404) fail("missing pool → 404", `got ${missing.status}`, missing.ms);
  else pass("missing pool → 404", "not found", missing.ms);
}

async function main(): Promise<void> {
  console.log(`Oddtasy TxLINE integration e2e → ${BASE_URL}\n`);

  if (!(await checkHealth())) {
    process.exitCode = 1;
    return;
  }

  const fixtures = await checkFixtures();
  if (!fixtures.length) {
    process.exitCode = 1;
    return;
  }

  const priced = await findPricedFixture(fixtures);
  if (!priced) {
    process.exitCode = 1;
    return;
  }

  await checkRawOdds(priced.fixture, priced.odds);
  await checkNormalizedMarkets(priced.fixture, priced.odds);
  const social = await checkSocialOptions(priced.fixture, priced.odds);
  await checkPoolsFlow(priced.fixture, social);
  await checkStreams(priced.fixture.fixtureId);
  await checkNegatives();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("e2e crashed:", err);
  process.exitCode = 1;
});

import { Connection } from "@solana/web3.js";
import { config } from "../config.js";
import { loadResolverKeypair } from "../chain/keypair.js";
import { streamHub } from "../stream/hub.js";
import type { TxLineScoreRow } from "../txline/types.js";
import {
  activePools,
  countLocalWinners,
  finalizingPoolsForFixture,
  markCancelled,
  markLocked,
  markResolved,
  markVoided,
} from "../pools/store.js";
import { loadOddtasyFixtures } from "../txline/normalize-fixtures.js";
import type { PoolRecord } from "../pools/types.js";
import { PoolProgram } from "../workers/resolve/poolProgram.js";
import { phaseAction, winningOutcome, type Score } from "../workers/resolve/settlement.js";

const GAME_STATE_PHASE: Record<string, number> = {
  F: 5,
  FET: 10,
  FPE: 13,
  I: 14,
  A: 15,
  C: 16,
  TXCC: 17,
  TXCS: 18,
  P: 19,
};

function normalizeGameState(raw?: string): string {
  return raw?.trim().toUpperCase() ?? "";
}

function phaseCodeFromScoreRow(row: TxLineScoreRow): number {
  const state = normalizeGameState(row.GameState ?? row.gameState);
  return GAME_STATE_PHASE[state] ?? 0;
}

function fixtureIdFromScoreRow(row: TxLineScoreRow): number | null {
  const fixtureId = row.FixtureId ?? row.fixtureId;
  return typeof fixtureId === "number" && Number.isFinite(fixtureId) ? fixtureId : null;
}

function participantGoals(row: TxLineScoreRow, side: "Participant1" | "Participant2"): number | undefined {
  const block = row.Score ?? row.scoreSoccer;
  const score = block?.[side];
  const h1 = score?.H1?.Goals;
  const h2 = score?.H2?.Goals;
  if (h1 != null || h2 != null) return (h1 ?? 0) + (h2 ?? 0);
  return score?.Total?.Goals;
}

function scoreFromRow(row: TxLineScoreRow): Score | null {
  const p1 = participantGoals(row, "Participant1");
  const p2 = participantGoals(row, "Participant2");
  if (p1 == null || p2 == null) return null;

  const participant1IsHome = row.Participant1IsHome ?? row.participant1IsHome ?? true;
  return participant1IsHome ? { home: p1, away: p2 } : { home: p2, away: p1 };
}

export function createPoolProgramFromEnv(): PoolProgram | null {
  const resolver = loadResolverKeypair();
  if (!resolver || !config.programIdlPath) return null;
  return new PoolProgram(new Connection(config.solanaRpc, "confirmed"), resolver);
}

/**
 * Finalize one pool to a known outcome — lock, resolve (or void when nobody
 * called it), and mirror the result into the local store.
 *
 * Exported because the dev resolve trigger drives this same function: a test
 * path that reimplemented settlement would prove the reimplementation works,
 * not the thing that runs in production.
 */
export async function settlePoolToOutcome(
  program: PoolProgram | null,
  pool: PoolRecord,
  outcome: number,
): Promise<void> {
  if (!program) {
    if (pool.status === "open") markLocked(pool.id);
    const { winners } = countLocalWinners(pool.id, outcome);
    if (winners === 0) {
      await markVoided(pool.id, outcome, "local-void");
      console.log(`[settlement] pool ${pool.id} voided locally`);
      return;
    }
    const totalPool = pool.entryCount * pool.stakeAmount;
    const rake = Math.floor((totalPool * pool.rakeBps) / 10_000);
    const share = Math.floor((totalPool - rake) / winners);
    await markResolved(pool.id, outcome, winners, String(share), "local-resolve");
    console.log(`[settlement] pool ${pool.id} resolved locally`);
    return;
  }

  const poolBytes = Buffer.from(pool.id.replace(/-/g, ""), "hex");
  const status = await program.status(poolBytes);
  if (status === "resolved" || status === "voided" || status === "cancelled") return;
  if (status === "open") await program.lock(poolBytes);

  const { winners } = await program.countWinners(poolBytes, outcome);
  const sig = await program.resolve(poolBytes, outcome, winners);
  if (winners === 0) {
    await markVoided(pool.id, outcome, sig);
  } else {
    const share = (await program.shareAmount(poolBytes)).toString();
    await markResolved(pool.id, outcome, winners, share, sig);
  }
  console.log(`[settlement] pool ${pool.id} finalized on-chain`);
}

async function settleFixture(params: {
  program: PoolProgram | null;
  fixtureId: number;
  phaseCode: number;
  score: Score | null;
}): Promise<void> {
  const action = phaseAction(params.phaseCode);
  if (action === "none" || action === "hold") return;
  if (action === "resolve" && !params.score) return;

  const pools = await finalizingPoolsForFixture(params.fixtureId);
  for (const pool of pools) {
    try {
      if (action === "cancel") {
        const sig = params.program
          ? await params.program.cancel(Buffer.from(pool.id.replace(/-/g, ""), "hex"))
          : "local-cancel";
        await markCancelled(pool.id, sig);
        console.log(`[settlement] pool ${pool.id} cancelled`);
        continue;
      }

      const outcome = winningOutcome(pool.marketType, pool.marketParam, params.score!);
      await settlePoolToOutcome(params.program, pool, outcome);
    } catch (err) {
      console.error("[settlement] pool finalize failed", {
        poolId: pool.id,
        fixtureId: params.fixtureId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Reconcile every still-open/locked pool against the fixtures snapshot.
 *
 * The stream-driven path above only fires when TxLINE *pushes* a score row.
 * On this feed that push is unreliable — a match can finish (its snapshot
 * carries the final score) without ever emitting a fresh stream event, leaving
 * its pools stuck "open" past kickoff and past full time. This sweep closes
 * that gap using the same derived fixture status the UI already trusts:
 *   - fixture finished  → settle the pool to the real result (locks then resolves)
 *   - kickoff passed, not yet finished → lock (betting is closed)
 *   - still scheduled   → leave open
 * It reuses settlePoolToOutcome, so it settles by the exact production path.
 */
export async function reconcilePools(program: PoolProgram | null): Promise<void> {
  const active = activePools();
  if (active.length === 0) return;

  const fixtures = await loadOddtasyFixtures();
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  const nowSec = Math.floor(Date.now() / 1000);

  for (const pool of active) {
    try {
      const fx = byId.get(pool.fixtureId);
      const finished =
        fx?.status === "finished" && fx.homeScore != null && fx.awayScore != null;

      if (finished) {
        const outcome = winningOutcome(pool.marketType, pool.marketParam, {
          home: fx!.homeScore!,
          away: fx!.awayScore!,
        });
        await settlePoolToOutcome(program, pool, outcome);
      } else if (pool.status === "open" && pool.deadline <= nowSec) {
        // Betting window shut even though we can't settle yet (match live, or
        // fixture missing from the current window) — reflect that as locked.
        markLocked(pool.id);
        console.log(`[reconcile] pool ${pool.id} locked (deadline passed)`);
      }
    } catch (err) {
      console.error("[reconcile] pool sweep failed", {
        poolId: pool.id,
        fixtureId: pool.fixtureId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

const RECONCILE_INTERVAL_MS = 30_000;

export function startSettlementWorker(program = createPoolProgramFromEnv()): void {
  streamHub.ensureUpstream("scores", true);

  // Snapshot reconciliation: catches matches the live stream never pushed an
  // event for. Runs once at boot (fixes anything already stuck) then on a timer.
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return; // never overlap a slow fixtures fetch with the next tick
    sweeping = true;
    try {
      await reconcilePools(program);
    } catch (err) {
      console.error("[reconcile] sweep error", err instanceof Error ? err.message : err);
    } finally {
      sweeping = false;
    }
  };
  void sweep();
  setInterval(() => void sweep(), RECONCILE_INTERVAL_MS);

  streamHub.subscribe("scores", (event) => {
    if (event.event === "heartbeat") return;
    try {
      const row = JSON.parse(event.data) as TxLineScoreRow;
      const fixtureId = fixtureIdFromScoreRow(row);
      if (fixtureId == null) return;
      void settleFixture({
        program,
        fixtureId,
        phaseCode: phaseCodeFromScoreRow(row),
        score: scoreFromRow(row),
      });
    } catch {
      // Ignore malformed score payloads.
    }
  });

  console.log(
    `[settlement] worker listening on TxLINE scores stream (${program ? "on-chain resolver" : "local mirror"} mode)`,
  );
}

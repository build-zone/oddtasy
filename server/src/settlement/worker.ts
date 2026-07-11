import { Connection } from "@solana/web3.js";
import { config } from "../config.js";
import { loadResolverKeypair } from "../chain/keypair.js";
import { streamHub } from "../stream/hub.js";
import type { TxLineScoreRow } from "../txline/types.js";
import {
  countLocalWinners,
  finalizingPoolsForFixture,
  markCancelled,
  markLocked,
  markResolved,
  markVoided,
} from "../pools/store.js";
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

      if (!params.program) {
        if (pool.status === "open") markLocked(pool.id);
        const { winners } = countLocalWinners(pool.id, outcome);
        if (winners === 0) {
          await markVoided(pool.id, outcome, "local-void");
          console.log(`[settlement] pool ${pool.id} voided locally`);
          continue;
        }
        const totalPool = pool.entryCount * pool.stakeAmount;
        const rake = Math.floor((totalPool * pool.rakeBps) / 10_000);
        const share = Math.floor((totalPool - rake) / winners);
        await markResolved(pool.id, outcome, winners, String(share), "local-resolve");
        console.log(`[settlement] pool ${pool.id} resolved locally`);
        continue;
      }

      const poolBytes = Buffer.from(pool.id.replace(/-/g, ""), "hex");
      const status = await params.program.status(poolBytes);
      if (status === "resolved" || status === "voided" || status === "cancelled") continue;
      if (status === "open") await params.program.lock(poolBytes);

      const { winners } = await params.program.countWinners(poolBytes, outcome);
      const sig = await params.program.resolve(poolBytes, outcome, winners);
      if (winners === 0) {
        await markVoided(pool.id, outcome, sig);
      } else {
        const share = (await params.program.shareAmount(poolBytes)).toString();
        await markResolved(pool.id, outcome, winners, share, sig);
      }
      console.log(`[settlement] pool ${pool.id} finalized on-chain`);
    } catch (err) {
      console.error("[settlement] pool finalize failed", {
        poolId: pool.id,
        fixtureId: params.fixtureId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startSettlementWorker(program = createPoolProgramFromEnv()): void {
  streamHub.ensureUpstream("scores", true);

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

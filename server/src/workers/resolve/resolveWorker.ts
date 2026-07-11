/**
 * resolveWorker.ts — orchestration.
 *
 * Called by the ingestion worker when a TxLINE scores-stream event reports a
 * terminal phase for a fixture (see adapter spec: the ingestion worker owns the
 * TxLINE subscription; this is the Pattern B settlement it hands off to).
 *
 * `finalizeFixture` is idempotent by construction: it reads on-chain status first
 * and only advances a pool that hasn't already settled, so re-delivery of the same
 * TxLINE event, a retry, or a duplicate stream never double-settles. The program
 * is the final backstop (resolve/lock/cancel all reject non-matching states), but
 * we avoid relying on caught errors by checking status up front.
 */
import { PublicKey } from "@solana/web3.js";
import { PoolProgram, type ChainStatus } from "./poolProgram.js";
import { phaseAction, winningOutcome, type Score } from "./settlement.js";

export interface PoolRow {
  id: string; // uuid
  marketType: number;
  marketParam: number;
}

/**
 * DB writes. Implement with PgTyped (routes -> services -> queries). Reference SQL:
 *
 * finalizingPoolsForFixture(fixtureId):
 *   SELECT id, market_type AS "marketType", market_param AS "marketParam"
 *   FROM pools WHERE fixture_id = :fixtureId AND status IN ('open','locked');
 *
 * markResolved(poolId, winningOutcome, winnerCount, shareAmount, txSig):
 *   UPDATE pools SET status='resolved', winning_outcome=:winningOutcome,
 *     winner_count=:winnerCount, share_amount=:shareAmount,
 *     tx_signature_resolve=:txSig, resolved_at=now() WHERE id=:poolId;
 *   UPDATE entries SET status = CASE WHEN prediction=:winningOutcome THEN 'won' ELSE 'lost' END
 *     WHERE pool_id=:poolId AND status='active';
 *
 * markVoided(poolId, winningOutcome, txSig):
 *   UPDATE pools SET status='voided', winning_outcome=:winningOutcome,
 *     tx_signature_resolve=:txSig, resolved_at=now() WHERE id=:poolId;
 *
 * markCancelled(poolId, txSig):
 *   UPDATE pools SET status='cancelled', tx_signature_resolve=:txSig WHERE id=:poolId;
 */
export interface Repo {
  finalizingPoolsForFixture(fixtureId: string): Promise<PoolRow[]>;
  markResolved(poolId: string, winningOutcome: number, winnerCount: number, shareAmount: string, txSig: string): Promise<void>;
  markVoided(poolId: string, winningOutcome: number, txSig: string): Promise<void>;
  markCancelled(poolId: string, txSig: string): Promise<void>;
  /** Reconcile the DB to on-chain state without a new tx (recovery path). */
  syncTerminal(poolId: string, status: ChainStatus): Promise<void>;
}

export interface Logger {
  info(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/** uuid string -> 16 raw bytes for the pool_id seed / instruction arg. */
export function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

const TERMINAL: ChainStatus[] = ["resolved", "voided", "cancelled"];

/**
 * Finalize every not-yet-settled pool on a fixture.
 * @param score The 90-minute regulation score (from settlement.regulationScore).
 */
export async function finalizeFixture(
  program: PoolProgram,
  repo: Repo,
  log: Logger,
  fixtureId: string,
  phaseCode: number,
  score: Score,
): Promise<void> {
  const action = phaseAction(phaseCode);
  if (action === "none" || action === "hold") return;

  const pools = await repo.finalizingPoolsForFixture(fixtureId);
  for (const pool of pools) {
    const poolId = uuidToBytes(pool.id);
    try {
      const status = await program.status(poolId);

      // Already settled on-chain (a prior run, or a manual op). Reconcile and skip.
      if (TERMINAL.includes(status)) {
        await repo.syncTerminal(pool.id, status);
        continue;
      }

      if (action === "cancel") {
        const sig = await program.cancel(poolId);
        await repo.markCancelled(pool.id, sig);
        log.info("pool cancelled", { pool: pool.id, fixtureId });
        continue;
      }

      // action === "resolve". Ensure the pool is locked (in case the lock worker
      // missed kickoff); entries are already closed by the on-chain deadline.
      if (status === "open") await program.lock(poolId);

      const outcome = winningOutcome(pool.marketType, pool.marketParam, score);
      const { winners } = await program.countWinners(poolId, outcome);

      const sig = await program.resolve(poolId, outcome, winners);

      if (winners === 0) {
        await repo.markVoided(pool.id, outcome, sig);
        log.info("pool voided (no winners), refunds open", { pool: pool.id, outcome });
      } else {
        const share = (await program.shareAmount(poolId)).toString();
        await repo.markResolved(pool.id, outcome, winners, share, sig);
        log.info("pool resolved", { pool: pool.id, outcome, winners, share });
      }
    } catch (err) {
      // Transient (RPC hiccup, congestion): the pool stays Locked, so the next
      // stream event or a retry sweep re-attempts. Never leaves partial state,
      // because each on-chain call is atomic and status-gated.
      log.error("finalize failed, will retry", { pool: pool.id, fixtureId, err: String(err) });
    }
  }
}

/**
 * Optional: a retry sweep to run on a timer, catching pools whose match already
 * finished but whose stream event was missed or failed. Same idempotent core.
 */
export async function retryStuckFixture(
  program: PoolProgram,
  repo: Repo,
  log: Logger,
  fixtureId: string,
  phaseCode: number,
  score: Score,
): Promise<void> {
  await finalizeFixture(program, repo, log, fixtureId, phaseCode, score);
}

// Re-export so callers import treasury/config-aware helpers from one place.
export { PoolProgram } from "./poolProgram.js";
export type { PublicKey };

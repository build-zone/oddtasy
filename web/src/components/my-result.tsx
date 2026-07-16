"use client";

import { StatusPill } from "./status-pill";
import { usdc, usdcFromBase } from "@/lib/format";
import type { PoolRecord } from "@/lib/types";

/**
 * The viewer's own result for a pool.
 *
 * A pool's StatusPill reports that the match settled; it says nothing about the
 * person reading it, so a win and a loss used to render identically on /me.
 * Once there is an outcome we show theirs instead — and an unclaimed win is the
 * loud one, because money you haven't taken yet is the only thing on this page
 * worth chasing.
 *
 * Falls back to the pool's own state while nothing is decided, which is still
 * the honest answer at that point.
 */
export function MyResult({ pool }: { pool: PoolRecord }) {
  const viewer = pool.viewer;

  if (viewer?.status === "won") {
    const amount = pool.shareAmount != null ? usdcFromBase(pool.shareAmount) : null;
    const claimed = Boolean(viewer.claimTxSignature);
    return (
      <span className="shrink-0 flex flex-col items-end gap-0.5">
        <span
          className={`font-mono text-[9px] tracking-[0.14em] uppercase ${
            claimed ? "text-faint" : "text-home"
          }`}
        >
          {claimed ? "collected" : "you won"}
        </span>
        <span
          className={`font-semibold text-[15px] leading-none ${
            claimed ? "text-muted" : "text-home"
          }`}
        >
          {amount ?? "—"}
        </span>
        {!claimed && <span className="font-mono text-[9.5px] text-muted">tap to collect</span>}
      </span>
    );
  }

  if (viewer?.status === "lost") {
    return (
      <span className="shrink-0 font-mono text-[10.5px] text-faint text-right">Not this time</span>
    );
  }

  if (viewer?.status === "refunded" || pool.status === "voided" || pool.status === "cancelled") {
    return (
      <span className="shrink-0 flex flex-col items-end gap-0.5">
        <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-muted">
          {viewer?.claimTxSignature ? "refunded" : "refund due"}
        </span>
        <span className="font-semibold text-[13.5px] leading-none text-muted">
          {usdc(pool.stakeUsdc)}
        </span>
      </span>
    );
  }

  return <StatusPill status={pool.status} live={pool.status === "locked"} />;
}

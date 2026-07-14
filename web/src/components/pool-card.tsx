"use client";

import Link from "next/link";
import { StatusPill } from "./status-pill";
import type { PoolRecord } from "@/lib/types";
import { countdown, usdc } from "@/lib/format";

const MARKET_LABEL: Record<string, string> = {
  match_result: "Match result",
  over_under: "Over/Under",
  correct_score: "Correct score",
};

export function PoolCard({ pool }: { pool: PoolRecord }) {
  const pot = pool.stakeUsdc * pool.entryCount;
  const marketLabel =
    MARKET_LABEL[pool.marketKey] ?? pool.marketKey;

  return (
    <Link
      href={`/pools/${pool.id}`}
      className="fade-in flex flex-col gap-2.5 bg-surface border border-line2 rounded-[14px] p-4 transition-colors hover:border-[#33564a]"
    >
      <div className="flex items-center gap-2.5">
        <b className="font-semibold text-[14.5px] truncate">{pool.fixtureLabel}</b>
        <span className="ml-auto shrink-0">
          <StatusPill status={pool.status} live={pool.status === "locked"} />
        </span>
      </div>

      <p className="font-mono text-[11px] text-muted truncate">
        {marketLabel}
        {pool.marketKey === "over_under" ? ` ${pool.marketParam}` : ""}
        {pool.optionLabel ? ` · host picked ${pool.optionLabel}` : ""}
      </p>

      <div className="flex gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="k">bet</span>
          <span className="font-mono font-semibold text-[13px]">{usdc(pool.stakeUsdc)}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="k">prize</span>
          <span className="font-mono font-semibold text-[13px] text-home">{usdc(pot)}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="k">joined</span>
          <span className="font-mono font-semibold text-[13px]">
            {pool.entryCount}/{pool.maxEntries}
          </span>
        </span>
        <span className="flex flex-col gap-0.5 ml-auto text-right">
          <span className="k">{pool.status === "open" ? "closes in" : "deadline"}</span>
          <span className="font-mono font-semibold text-[13px]">
            {countdown(pool.deadline)}
          </span>
        </span>
      </div>
    </Link>
  );
}

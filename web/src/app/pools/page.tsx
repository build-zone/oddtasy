"use client";

import { useState } from "react";
import { PoolCard } from "@/components/pool-card";
import { usePools } from "@/hooks/use-queries";
import type { PoolStatus } from "@/lib/types";

const FILTERS: { label: string; value: PoolStatus | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Open", value: "open" },
  { label: "Locked", value: "locked" },
  { label: "Resolved", value: "resolved" },
];

export default function PoolsPage() {
  const [status, setStatus] = useState<PoolStatus | undefined>(undefined);
  const { data: pools, isLoading, isError, refetch } = usePools(
    status ? { status } : undefined,
  );

  return (
    <div className="pt-2">
      <div className="flex gap-1 bg-surface border border-line2 rounded-[11px] p-[3px] w-fit mx-auto mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setStatus(f.value)}
            className={`font-mono text-xs px-4 py-2 rounded-lg cursor-pointer transition-colors ${
              status === f.value
                ? "bg-surface2 text-ink shadow-[inset_0_0_0_1px_var(--line2)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[120px] rounded-[14px] bg-surface border border-line animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="font-mono text-xs text-faint text-center py-8 bg-surface border border-dashed border-line2 rounded-[14px]">
          Couldn&apos;t load pools.
          <button
            onClick={() => refetch()}
            className="block mx-auto mt-3 text-home cursor-pointer underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      )}

      {pools && (
        <div className="flex flex-col gap-3">
          {pools.map((p) => (
            <PoolCard key={p.id} pool={p} />
          ))}
          {pools.length === 0 && (
            <div className="font-mono text-xs text-faint text-center py-10 bg-surface border border-dashed border-line2 rounded-[14px]">
              No pools yet — open one from any match.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

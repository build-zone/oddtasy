"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FixtureCard } from "@/components/fixture-card";
import { useFixtures } from "@/hooks/use-queries";
import { dayKey } from "@/lib/format";

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[92px] rounded-[14px] bg-surface border border-line animate-pulse" />
      ))}
    </div>
  );
}

type DayCell = {
  label: string; // grouping key, e.g. "Mon, Jul 13"
  dow: string;
  dnum: number;
  month: string;
  count: number;
  allFinished: boolean;
  isToday: boolean;
};

export default function MatchesPage() {
  const { data: fixtures, isLoading, isError, refetch } = useFixtures();
  const [day, setDay] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const sorted = useMemo(
    () => (fixtures ? [...fixtures].sort((a, b) => a.StartTime - b.StartTime) : []),
    [fixtures],
  );

  const days = useMemo<DayCell[]>(() => {
    const todayLabel = dayKey(new Date().toISOString());
    const byLabel = new Map<string, DayCell>();
    for (const f of sorted) {
      const label = dayKey(f.kickoffIso);
      let cell = byLabel.get(label);
      if (!cell) {
        const d = new Date(f.kickoffIso);
        cell = {
          label,
          dow: d.toLocaleDateString(undefined, { weekday: "short" }),
          dnum: d.getDate(),
          month: d.toLocaleDateString(undefined, { month: "short" }),
          count: 0,
          allFinished: true,
          isToday: label === todayLabel,
        };
        byLabel.set(label, cell);
      }
      cell.count += 1;
      if (f.status !== "finished") cell.allFinished = false;
    }
    return [...byLabel.values()];
  }, [sorted]);

  // default day: first day that still has something to play
  const dayIdx = useMemo(() => {
    if (day != null) return Math.min(day, Math.max(days.length - 1, 0));
    const idx = days.findIndex((d) => !d.allFinished);
    return idx >= 0 ? idx : Math.max(days.length - 1, 0);
  }, [day, days]);

  // keep the selected day cell in view (centered) when it changes or loads
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: day == null ? "auto" : "smooth",
    });
  }, [dayIdx, days.length, day]);

  const visible = useMemo(() => {
    const label = days[dayIdx]?.label;
    return label ? sorted.filter((f) => dayKey(f.kickoffIso) === label) : sorted;
  }, [days, dayIdx, sorted]);

  return (
    <div className="pt-2">
      {/* No preamble — the matches are the product. Anyone who needs the rules
          gets them at the point of betting, in the host sheet. */}

      {days.length > 0 && (
        <div ref={stripRef} className="caldays mb-4" role="tablist" aria-label="Match days">
          {days.map((d, i) => {
            const selected = i === dayIdx;
            return (
              <button
                key={d.label}
                ref={selected ? selectedRef : undefined}
                role="tab"
                aria-selected={selected}
                className={`day ${d.isToday ? "today" : ""} ${d.allFinished ? "done" : ""}`}
                onClick={() => setDay(i)}
                title={`${d.label} · ${d.count} game${d.count > 1 ? "s" : ""}`}
              >
                <span className="dow">{d.dnum === 1 || i === 0 ? d.month : d.dow}</span>
                <span className="dnum">{d.dnum}</span>
                <span className="cnt">
                  {d.allFinished ? "FT" : `${d.count} game${d.count > 1 ? "s" : ""}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading && <Skeleton />}

      {isError && (
        <div className="font-mono text-xs text-faint text-center py-8 bg-surface border border-dashed border-line2 rounded-[14px]">
          Couldn&apos;t reach the Oddtasy API — is the server running on :4100?
          <button
            onClick={() => refetch()}
            className="block mx-auto mt-3 text-home cursor-pointer underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="flex flex-col gap-3">
          {visible.map((f) => (
            <FixtureCard key={f.fixtureId} fixture={f} />
          ))}
          {visible.length === 0 && (
            <div className="font-mono text-xs text-faint text-center py-8 bg-surface border border-dashed border-line2 rounded-[14px]">
              No fixtures for this day.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

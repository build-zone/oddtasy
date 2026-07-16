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

  // A thin day (1–2 games) left dead space below the list. Show the selected
  // day, then everything still to play after it under a "Coming up" — spanning
  // later days — so the list runs as long as there are matches to scan rather
  // than stopping short. Each card carries its own date, so the spillover reads
  // clearly. (Only upcoming fixtures fill in; past days aren't back-filled.)
  const { onDay, ahead } = useMemo(() => {
    const label = days[dayIdx]?.label;
    if (!label) return { onDay: sorted, ahead: [] as typeof sorted };
    const onDay = sorted.filter((f) => dayKey(f.kickoffIso) === label);
    const last = onDay[onDay.length - 1];
    const startIdx = last ? sorted.indexOf(last) + 1 : 0;
    const ahead = sorted.slice(startIdx).filter((f) => f.status !== "finished");
    return { onDay, ahead };
  }, [days, dayIdx, sorted]);

  return (
    <div className="pt-2">
      {/* Centered hero above the day strip. The title runs home-gold → away-cyan
          — the app's two match colours — so the brand identity is in the name
          itself. Rules stay at the point of betting, in the host sheet. */}
      <div className="text-center mt-1 mb-6">
        <h1
          className="text-[clamp(26px,7.6vw,38px)] font-bold tracking-tight leading-[1.05]"
          style={{
            backgroundImage: "linear-gradient(92deg, var(--home) 5%, var(--away) 95%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Social betting pools
        </h1>
        <p className="font-mono text-[11px] text-faint mt-2">
          Bet with friends · winners split the prize
        </p>
      </div>

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
          {onDay.map((f) => (
            <FixtureCard key={f.fixtureId} fixture={f} />
          ))}
          {ahead.length > 0 && (
            <>
              <p className="k mt-2 mb-0.5">Coming up</p>
              {ahead.map((f) => (
                <FixtureCard key={f.fixtureId} fixture={f} />
              ))}
            </>
          )}
          {onDay.length === 0 && ahead.length === 0 && (
            <div className="font-mono text-xs text-faint text-center py-8 bg-surface border border-dashed border-line2 rounded-[14px]">
              No fixtures for this day.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

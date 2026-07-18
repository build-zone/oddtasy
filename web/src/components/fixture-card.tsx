"use client";

import Link from "next/link";
import { StatusPill } from "./status-pill";
import { awayTeam, homeTeam, type OddtasyFixture } from "@/lib/types";
import { kickoffLabel } from "@/lib/format";

function TeamChip({ name, side }: { name: string; side: "home" | "away" }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span
        className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center font-mono text-[9px] font-semibold ${
          side === "home" ? "text-[#10100a]" : "text-[#08222a]"
        }`}
        style={{
          background:
            side === "home"
              ? "linear-gradient(135deg, var(--home), #c98f2a)"
              : "linear-gradient(135deg, var(--away), #2f8fa6)",
        }}
      >
        {initials}
      </span>
      <b className="font-semibold text-[clamp(14px,3.6vw,16px)] truncate">{name}</b>
    </span>
  );
}

export function FixtureCard({ fixture }: { fixture: OddtasyFixture }) {
  const home = homeTeam(fixture);
  const away = awayTeam(fixture);
  const live = fixture.status === "live";
  const finished = fixture.status === "finished";
  const hasScore = fixture.homeScore != null && fixture.awayScore != null;

  return (
    <Link
      href={`/fixtures/${fixture.fixtureId}`}
      className="fade-in flex flex-col gap-2 bg-surface border border-line2 rounded-[14px] p-4 transition-colors hover:border-[#33564a]"
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <TeamChip name={home} side="home" />
        {hasScore ? (
          <span className="font-mono font-semibold text-[15px] shrink-0">
            {fixture.homeScore}–{fixture.awayScore}
          </span>
        ) : (
          <span className="font-mono text-xs text-faint shrink-0">vs</span>
        )}
        <TeamChip name={away} side="away" />
        <span className="ml-auto shrink-0">
          <StatusPill
            status={fixture.status}
            live={live}
            label={
              finished
                ? hasScore
                  ? `FT ${fixture.homeScore}–${fixture.awayScore}`
                  : // "finished" can be clock-derived with no score behind it
                    "No result"
                : live
                  ? "Live"
                  : "Upcoming"
            }
          />
        </span>
      </div>
      <p className="k !text-[10px]">
        {fixture.stage ?? fixture.CompetitionName ?? "Football"} ·{" "}
        {kickoffLabel(fixture.kickoffIso)}
      </p>
    </Link>
  );
}

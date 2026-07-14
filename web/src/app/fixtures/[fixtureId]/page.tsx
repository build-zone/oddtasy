"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MarketPicker, type MarketSelection } from "@/components/market-picker";
import { Sheet } from "@/components/sheet";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import { useLiveScore } from "@/hooks/use-live-score";
import { useFixtures, usePools, useSocialOptions } from "@/hooks/use-queries";
import { useWallet } from "@/hooks/use-wallet";
import { api } from "@/lib/api";
import { kickoffLabel, odds, usdc } from "@/lib/format";
import { fixtureLambdas } from "@/lib/priors";
import { awayTeam, homeTeam } from "@/lib/types";
import { AttributionLine, GoalsChart } from "@/components/goals-chart";
import { PoolCard } from "@/components/pool-card";

export default function FixturePage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  const { fixtureId: fixtureIdRaw } = use(params);
  const fixtureId = Number(fixtureIdRaw);
  const router = useRouter();
  const toast = useToast();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  const { data: fixtures } = useFixtures();
  const fixture = fixtures?.find((f) => f.fixtureId === fixtureId) ?? null;
  const lambdas = fixture ? fixtureLambdas(fixture) : null;
  const { data: options, isLoading: optionsLoading } = useSocialOptions(fixtureId, lambdas);
  const { data: fixturePools } = usePools({ fixtureId });
  const { score } = useLiveScore(fixtureId, fixture?.status === "live");

  const [selection, setSelection] = useState<MarketSelection | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stake, setStake] = useState(5);
  const [maxEntries, setMaxEntries] = useState(20);

  const home = fixture ? homeTeam(fixture) : "Home";
  const away = fixture ? awayTeam(fixture) : "Away";

  // live score arrives in participant order; map to home/away via the fixture
  const liveHome =
    score && fixture
      ? fixture.Participant1IsHome
        ? score.p1Goals
        : score.p2Goals
      : null;
  const liveAway =
    score && fixture
      ? fixture.Participant1IsHome
        ? score.p2Goals
        : score.p1Goals
      : null;
  const homeScore = liveHome ?? fixture?.homeScore ?? null;
  const awayScore = liveAway ?? fixture?.awayScore ?? null;

  const kickoffPassed = fixture ? fixture.StartTime <= Date.now() : false;

  const createPool = useMutation({
    mutationFn: async (sel: MarketSelection) => {
      if (!wallet.address) throw new Error("Log in first");
      if (!fixture) throw new Error("Fixture not loaded");
      const res = await api.createPool({
        hostWallet: wallet.address,
        fixtureId,
        fixtureLabel: `${home} vs ${away}`,
        marketType: sel.market.marketType,
        marketKey: sel.market.marketKey,
        marketParam: sel.market.marketParam,
        outcomeCount: sel.market.outcomeCount,
        optionLabel: sel.option.label,
        stakeUsdc: stake,
        maxEntries,
        deadline: Math.floor(fixture.StartTime / 1000),
        hostPrediction: sel.option.prediction,
      });
      if (res.transaction) {
        const signature = await wallet.signAndSendBase64(res.transaction);
        await api.reportTx(res.pool.id, { kind: "create", signature }).catch(() => {});
        toast(`Pool live on-chain · ${signature.slice(0, 8)}…`);
      } else {
        toast("Pool recorded — off-chain only (betting program unreachable).");
      }
      return res;
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["pools"] });
      setSheetOpen(false);
      router.push(`/pools/${res.pool.id}`);
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to create pool"),
  });

  const openPools = useMemo(
    () => (fixturePools ?? []).filter((p) => p.status === "open"),
    [fixturePools],
  );

  if (!fixture && fixtures) {
    return (
      <div className="font-mono text-xs text-faint text-center py-10">
        Fixture not found. <Link href="/" className="text-home underline underline-offset-4">Back to matches</Link>
      </div>
    );
  }

  return (
    // NOTE: no transform animation on this wrapper — it contains a
    // position:fixed Sheet, and an animated ancestor becomes its containing
    // block, un-pinning the sheet from the viewport.
    <div className="pt-2">
      <Link href="/" className="font-mono text-xs text-muted hover:text-ink cursor-pointer inline-block mb-3.5 bg-transparent border-0 p-0">
        ← Matches
      </Link>

      {/* match header */}
      <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
        <span className="text-[clamp(15px,4vw,18px)] font-semibold">{home}</span>
        {homeScore != null && awayScore != null ? (
          <span className="font-mono font-bold text-[clamp(17px,4.6vw,22px)]">
            {homeScore}–{awayScore}
          </span>
        ) : (
          <span className="font-mono text-xs text-faint">vs</span>
        )}
        <span className="text-[clamp(15px,4vw,18px)] font-semibold">{away}</span>
        <span className="ml-auto">
          <StatusPill
            status={fixture?.status ?? "scheduled"}
            live={fixture?.status === "live"}
            label={
              fixture?.status === "finished"
                ? "FT"
                : fixture?.status === "live"
                  ? "Live"
                  : "Upcoming"
            }
          />
        </span>
      </div>
      <p className="k !text-[10px] mb-6">
        {fixture?.stage ?? fixture?.CompetitionName ?? ""} ·{" "}
        {fixture ? kickoffLabel(fixture.kickoffIso) : ""}
      </p>

      {kickoffPassed ? (
        <p className="font-mono text-[11px] text-faint text-center bg-surface border border-line2 rounded-[12px] px-4 py-3 mb-6">
          Kickoff has passed — new pools can&apos;t be opened on this match, but
          existing ones play out below.
        </p>
      ) : (
        <p className="font-mono text-[11px] text-faint text-center mb-4">
          Tap an outcome to start a pool
        </p>
      )}

      {/* markets */}
      {optionsLoading && (
        <div className="h-[220px] rounded-[14px] bg-surface border border-line animate-pulse" />
      )}
      {options && !kickoffPassed && (
        <>
          {lambdas && (
            <section className="mb-7">
              <p className="k mb-2.5">Goals forecast</p>
              <GoalsChart lambdas={lambdas} />
            </section>
          )}
          <MarketPicker
            markets={options.socialMarkets}
            homeName={home}
            awayName={away}
            selection={selection}
            onSelect={(sel) => {
              setSelection(sel);
              setSheetOpen(true);
            }}
          />
          {lambdas && (
            <AttributionLine homeName={home} awayName={away} lambdas={lambdas} />
          )}
        </>
      )}
      {options && options.socialMarkets.length === 0 && (
        <div className="font-mono text-xs text-faint text-center py-8 bg-surface border border-dashed border-line2 rounded-[14px]">
          TxLINE has no priced markets for this fixture yet.
        </div>
      )}

      {/* open pools on this fixture */}
      {openPools.length > 0 && (
        <section className="mt-8">
          <p className="k mb-2.5">Open pools on this match</p>
          <div className="flex flex-col gap-3">
            {openPools.map((p) => (
              <PoolCard key={p.id} pool={p} />
            ))}
          </div>
        </section>
      )}

      {/* host-a-pool sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Host a pool">
        {selection && (
          <>
            <div className="flex items-center gap-3.5 mt-1.5 mb-4">
              <span className="font-bold text-[28px] leading-none text-home">
                {selection.option.label}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {selection.market.label}
                </span>
                <span className="font-mono text-xs text-muted">
                  odds <b className="text-ink">{odds(selection.option.decimalOdds)}</b>
                  {" · "}
                  <span className={selection.option.priceSource === "txline" ? "text-good" : "text-faint"}>
                    {selection.option.priceSource === "txline"
                      ? "TxLINE price"
                      : selection.option.priceSource === "model_fair"
                        ? "model fair price"
                        : "unpriced"}
                  </span>
                </span>
              </span>
            </div>

            <div className="flex flex-col gap-3 mb-4">
              <label className="flex flex-col gap-2.5">
                <span className="k">everyone bets — {usdc(stake)}</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={stake}
                  onChange={(e) => setStake(Number(e.target.value))}
                  className="cs-range"
                  style={{
                    background: `linear-gradient(90deg, var(--home) ${stake}%, #2a3a31 ${stake}%)`,
                  }}
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="k">max spots</span>
                <input
                  type="number"
                  min={2}
                  max={200}
                  value={maxEntries}
                  onChange={(e) => setMaxEntries(Number(e.target.value))}
                  className="w-20 bg-surface border border-line2 rounded-lg px-3 py-2 font-mono text-sm text-ink text-right"
                />
              </label>
              <div className="flex items-center justify-between">
                <span className="k">house fee</span>
                <span className="font-mono text-sm">5%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="k">betting closes</span>
                <span className="font-mono text-sm">at kickoff</span>
              </div>
            </div>

            <button
              className="cta"
              disabled={!wallet.authenticated || createPool.isPending}
              onClick={() => selection && createPool.mutate(selection)}
            >
              {createPool.isPending
                ? "Starting…"
                : wallet.authenticated
                  ? `Start pool · bet ${usdc(stake)}`
                  : "Log in to start"}
            </button>
            <p className="font-mono text-[10.5px] leading-relaxed text-faint text-center mt-3">
              Your {usdc(stake)} on {selection.option.label} is the first bet in
              — everyone who joins bets the same {usdc(stake)} (devnet USDC).
              Winners split the prize when the final whistle goes.
            </p>
          </>
        )}
      </Sheet>
    </div>
  );
}

"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AttributionLine, GoalsChart } from "@/components/goals-chart";
import { LiveStage } from "@/components/live-stage";
import { MarketPicker } from "@/components/market-picker";
import { Sheet } from "@/components/sheet";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";
import { WinTakeover } from "@/components/win-takeover";
import { useFixtures, usePool, useSocialOptions } from "@/hooks/use-queries";
import { useWallet } from "@/hooks/use-wallet";
import { api } from "@/lib/api";
import { countdown, odds, shortWallet, usdc, usdcFromBase } from "@/lib/format";
import { fixtureLambdas, modelCoverage } from "@/lib/priors";
import { awayTeam, homeTeam, type SocialOption } from "@/lib/types";

const MARKET_LABEL: Record<string, string> = {
  match_result: "Match result",
  over_under: "Over/Under",
  correct_score: "Correct score",
  btts: "Both teams to score",
  odd_even: "Total goals odd/even",
};

export default function PoolPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = use(params);
  const toast = useToast();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = usePool(poolId);
  const pool = data?.pool ?? null;
  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);

  const { data: fixtures } = useFixtures();
  const fixture = pool
    ? (fixtures?.find((f) => f.fixtureId === pool.fixtureId) ?? null)
    : null;

  // options for this pool's market — with model priors so joiners always
  // have an analysis to look at, not bare labels
  const lambdas = fixture ? fixtureLambdas(fixture) : null;
  const coverage = fixture ? modelCoverage(fixture) : null;
  const { data: options } = useSocialOptions(pool?.fixtureId ?? null, lambdas);
  const market = options?.socialMarkets.find(
    (m) =>
      pool != null &&
      m.marketType === pool.marketType &&
      m.marketParam === pool.marketParam,
  );

  const [pick, setPick] = useState<SocialOption | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The win takeover opens itself once, on an unclaimed win, and stays open
  // through the claim so the payout lands inside the moment. Dismissing is
  // sticky: a settled win never ambushes you again on revisit.
  const [winOpen, setWinOpen] = useState(false);
  const [winDismissed, setWinDismissed] = useState(false);

  const viewerEntry = wallet.address
    ? entries.find((e) => e.wallet === wallet.address)
    : undefined;

  const unclaimedWin =
    pool?.status === "resolved" &&
    viewerEntry?.status === "won" &&
    !viewerEntry.claimTxSignature &&
    pool.shareAmount != null;

  useEffect(() => {
    if (unclaimedWin && !winDismissed) setWinOpen(true);
  }, [unclaimedWin, winDismissed]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pool", poolId] });
    void queryClient.invalidateQueries({ queryKey: ["pools"] });
    void queryClient.invalidateQueries({ queryKey: ["balances"] });
  };

  const enterPool = useMutation({
    mutationFn: async (option: SocialOption) => {
      if (!wallet.address) throw new Error("Log in first");
      if (!pool) throw new Error("Pool not loaded");
      const res = await api.enterPool(pool.id, {
        wallet: wallet.address,
        prediction: option.prediction,
        optionLabel: option.label,
      });
      if (res.transaction) {
        const signature = await wallet.signAndSendBase64(res.transaction);
        await api.reportTx(pool.id, { kind: "enter", signature, wallet: wallet.address }).catch(() => {});
        toast(`Bet placed on-chain · ${signature.slice(0, 8)}…`);
      } else {
        toast("You're in! (Off-chain only — the betting program isn't reachable.)");
      }
      return res;
    },
    onSuccess: () => {
      setSheetOpen(false);
      refresh();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Failed to enter"),
  });

  const finishCreate = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Log in first");
      if (!pool) throw new Error("Pool not loaded");
      const res = await api.createPoolTx(pool.id, wallet.address);
      const signature = await wallet.signAndSendBase64(res.transaction);
      await api.reportTx(pool.id, { kind: "create", signature }).catch(() => {});
      return signature;
    },
    onSuccess: (signature) => {
      toast(`Pool live on-chain · ${signature.slice(0, 8)}…`);
      refresh();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Couldn't create on-chain"),
  });

  const finishPayment = useMutation({
    mutationFn: async () => {
      if (!wallet.address) throw new Error("Log in first");
      if (!pool) throw new Error("Pool not loaded");
      const res = await api.entryPaymentTx(pool.id, wallet.address);
      const signature = await wallet.signAndSendBase64(res.transaction);
      await api.reportTx(pool.id, { kind: "enter", signature, wallet: wallet.address }).catch(() => {});
      return signature;
    },
    onSuccess: (signature) => {
      toast(`Bet paid on-chain · ${signature.slice(0, 8)}…`);
      refresh();
    },
    onError: (err) => toast(err instanceof Error ? err.message : "Payment failed"),
  });

  const payout = useMutation({
    mutationFn: async (kind: "claim" | "refund") => {
      if (!wallet.address) throw new Error("Log in first");
      if (!pool) throw new Error("Pool not loaded");
      const res = await api.claimPool(pool.id, wallet.address, kind);
      const signature = await wallet.signAndSendBase64(res.transaction);
      await api.reportTx(pool.id, { kind, signature, wallet: wallet.address }).catch(() => {});
      return { kind, signature };
    },
    onSuccess: ({ kind, signature }) => {
      // The takeover shows its own paid state — a toast on top of it would
      // just talk over the moment.
      if (!winOpen) {
        toast(
          `${kind === "claim" ? "Winnings claimed" : "Money refunded"} · ${signature.slice(0, 8)}…`,
        );
      }
      refresh();
    },
    onError: (err) =>
      toast(err instanceof Error ? err.message : "Couldn't complete the payout"),
  });

  if (isLoading) {
    return <div className="mt-6 h-[300px] rounded-[14px] bg-surface border border-line animate-pulse" />;
  }
  if (isError || !pool) {
    return (
      <div className="font-mono text-xs text-faint text-center py-10">
        Pool not found.{" "}
        <button onClick={() => refetch()} className="text-home underline underline-offset-4 cursor-pointer">
          Retry
        </button>{" "}
        · <Link href="/pools" className="text-home underline underline-offset-4">All pools</Link>
      </div>
    );
  }

  const pot = pool.stakeUsdc * pool.entryCount;
  const marketLabel = MARKET_LABEL[pool.marketKey] ?? pool.marketKey;
  const sealed = pool.status === "open";
  const winningOption = market?.options.find(
    (o) => o.prediction === pool.winningOutcome,
  );

  return (
    // NOTE: no transform animation here — it contains a position:fixed Sheet
    // (see fixtures page note)
    <div className="pt-2">
      <Link href="/pools" className="font-mono text-xs text-muted hover:text-ink inline-block mb-3.5">
        ← Pools
      </Link>

      {/* header */}
      <div className="flex items-center gap-2.5 flex-wrap mb-1">
        <h1 className="text-[clamp(16px,4.4vw,20px)] font-bold m-0">{pool.fixtureLabel}</h1>
        <span className="ml-auto">
          <StatusPill status={pool.status} live={pool.status === "locked"} />
        </span>
      </div>
      <p className="k !text-[10px] mb-5">
        {marketLabel}
        {pool.marketKey === "over_under" ? ` ${pool.marketParam}` : ""} · hosted by{" "}
        {pool.hostName ?? shortWallet(pool.hostWallet)}
      </p>

      {/* the stage: countdown → live match → full time, with the group chat on it */}
      <div className="mb-4">
        <LiveStage poolId={pool.id} fixture={fixture} />
      </div>

      {/* stats */}
      <div className="flex gap-2.5 mb-5">
        {[
          { k: "bet", v: usdc(pool.stakeUsdc) },
          { k: "prize", v: usdc(pot), cls: "text-home" },
          { k: "joined", v: `${pool.entryCount} of ${pool.maxEntries}` },
          {
            k: pool.status === "open" ? "closes in" : "status",
            v: pool.status === "open" ? countdown(pool.deadline) : pool.status,
          },
        ].map((s) => (
          <div key={s.k} className="flex-1 flex flex-col gap-1 bg-surface border border-line2 rounded-[12px] px-3 py-2.5">
            <span className="k">{s.k}</span>
            <span className={`font-mono font-semibold text-[13.5px] ${s.cls ?? ""}`}>{s.v}</span>
          </div>
        ))}
      </div>

      {/* host: pool recorded but never signed on-chain */}
      {pool.status === "open" &&
        !pool.createTxSignature &&
        wallet.address === pool.hostWallet && (
          <div className="bg-surface border border-[#4d3f1e] rounded-[14px] px-4 py-3.5 mb-6">
            <p className="m-0 font-semibold text-sm">
              This pool isn&apos;t on-chain yet — bets can&apos;t be paid until it is.
            </p>
            <button
              className="cta mt-3"
              disabled={finishCreate.isPending}
              onClick={() => finishCreate.mutate()}
            >
              {finishCreate.isPending ? "Creating…" : "Put this pool on-chain"}
            </button>
          </div>
        )}

      {/* state-dependent action panel */}
      {pool.status === "open" && !viewerEntry && (
        <section className="mb-6">
          <p className="k mb-2.5">Pick your bet</p>
          {market ? (
            <>
              {pool.marketKey === "over_under" && lambdas && (
                <div className="mb-5">
                  <GoalsChart lambdas={lambdas} />
                </div>
              )}
              <MarketPicker
                markets={[market]}
                homeName={fixture ? homeTeam(fixture) : "Home"}
                awayName={fixture ? awayTeam(fixture) : "Away"}
                selection={
                  pick ? { market, option: pick } : null
                }
                onSelect={(sel) => {
                  setPick(sel.option);
                  setSheetOpen(true);
                }}
              />
              {lambdas && fixture && (
                <AttributionLine
                  homeName={homeTeam(fixture)}
                  awayName={awayTeam(fixture)}
                  lambdas={lambdas}
                  coverage={coverage ?? undefined}
                />
              )}
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: pool.outcomeCount }, (_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setPick({ prediction: i, key: String(i), label: `Outcome ${i}`, priceSource: "unpriced" });
                    setSheetOpen(true);
                  }}
                  className="font-mono text-xs font-semibold border border-line2 text-ink bg-surface2 rounded-[9px] px-3.5 py-2.5 cursor-pointer transition-colors hover:border-home hover:text-home"
                >
                  Outcome {i}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {pool.status === "open" && viewerEntry && viewerEntry.enterTxSignature && (
        <div className="bg-surface border border-line2 rounded-[14px] px-4 py-3.5 mb-6">
          <p className="m-0 font-semibold text-sm">
            You&apos;re in — <span className="text-home">{viewerEntry.optionLabel}</span>{" "}
            <span className="font-mono text-[10.5px] text-good">
              ✓ paid · {viewerEntry.enterTxSignature.slice(0, 8)}…
            </span>
          </p>
          <p className="m-0 mt-1 font-mono text-[11px] text-faint">
            Everyone&apos;s picks stay hidden until kickoff. Share the link so
            friends can join.
          </p>
        </div>
      )}

      {pool.status === "open" && viewerEntry && !viewerEntry.enterTxSignature && (
        <div className="bg-surface border border-[#4d3f1e] rounded-[14px] px-4 py-3.5 mb-6">
          <p className="m-0 font-semibold text-sm">
            Your pick is saved — <span className="text-home">{viewerEntry.optionLabel}</span> —
            but your {usdc(pool.stakeUsdc)} hasn&apos;t been paid yet.
          </p>
          <button
            className="cta mt-3"
            disabled={finishPayment.isPending || !wallet.authenticated}
            onClick={() => finishPayment.mutate()}
          >
            {finishPayment.isPending ? "Paying…" : `Pay ${usdc(pool.stakeUsdc)} to lock it in`}
          </button>
          <p className="m-0 mt-2 font-mono text-[10.5px] text-faint">
            Unpaid picks don&apos;t count when the pool settles.
          </p>
        </div>
      )}

      {pool.status === "locked" && (
        <div className="bg-surface border border-line2 rounded-[14px] px-4 py-3.5 mb-6">
          <p className="m-0 font-semibold text-sm">
            <span className="livedot" aria-hidden />
            Locked — the match decides it now.
          </p>
          <p className="m-0 mt-1 font-mono text-[11px] text-faint">
            Winners get paid automatically from the official 90-minute result.
          </p>
        </div>
      )}

      {pool.status === "resolved" && (
        <div className="bg-surface border border-line2 rounded-[14px] px-4 py-3.5 mb-6">
          <p className="m-0 font-semibold text-sm">
            Resolved —{" "}
            <span className="text-good">
              {winningOption?.label ?? `outcome ${pool.winningOutcome}`}
            </span>{" "}
            · {pool.winnerCount ?? 0} winner{(pool.winnerCount ?? 0) === 1 ? "" : "s"}
            {pool.shareAmount != null && <> · {usdcFromBase(pool.shareAmount)} each</>}
          </p>
          {viewerEntry?.status === "won" && !viewerEntry.claimTxSignature && (
            <button
              className="cta mt-3"
              disabled={payout.isPending}
              onClick={() => payout.mutate("claim")}
            >
              {payout.isPending
                ? "Claiming…"
                : `Claim ${pool.shareAmount != null ? usdcFromBase(pool.shareAmount) : "winnings"}`}
            </button>
          )}
          {viewerEntry?.claimTxSignature && (
            <p className="m-0 mt-2 font-mono text-[11px] text-good">
              ✓ Paid out · {viewerEntry.claimTxSignature.slice(0, 8)}…
            </p>
          )}
          {viewerEntry?.status === "lost" && (
            <p className="m-0 mt-1 font-mono text-[11px] text-faint">
              Not this time — your pick was {viewerEntry.optionLabel}.
            </p>
          )}
        </div>
      )}

      {(pool.status === "voided" || pool.status === "cancelled") && (
        <div className="bg-surface border border-line2 rounded-[14px] px-4 py-3.5 mb-6">
          <p className="m-0 font-semibold text-sm">
            {pool.status === "voided" ? "Voided — no winners." : "Cancelled."}
          </p>
          <p className="m-0 mt-1 font-mono text-[11px] text-faint">
            Everyone gets their full bet back{viewerEntry ? " — including you" : ""}.
          </p>
          {viewerEntry && !viewerEntry.claimTxSignature && (
            <button
              className="cta mt-3"
              disabled={payout.isPending}
              onClick={() => payout.mutate("refund")}
            >
              {payout.isPending ? "Refunding…" : `Get your ${usdc(pool.stakeUsdc)} back`}
            </button>
          )}
          {viewerEntry?.claimTxSignature && (
            <p className="m-0 mt-2 font-mono text-[11px] text-good">
              ✓ Refunded · {viewerEntry.claimTxSignature.slice(0, 8)}…
            </p>
          )}
        </div>
      )}

      {/* entries */}
      <section>
        <div className="flex items-baseline gap-2 mb-2.5">
          <p className="k m-0">Who&apos;s in</p>
          {sealed && (
            <span className="font-mono text-[10px] text-faint">picks hidden until kickoff</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {entries.map((e) => {
            const mine = wallet.address === e.wallet;
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 bg-surface border border-line2 rounded-[12px] px-3.5 py-3"
              >
                <span className="font-mono text-xs text-muted truncate">
                  {e.displayName ?? shortWallet(e.wallet)}
                </span>
                {mine && <span className="k !text-home">you</span>}
                <span className="ml-auto font-mono text-xs">
                  {sealed && !mine ? (
                    <span className="text-faint tracking-widest">•••</span>
                  ) : (
                    e.optionLabel
                  )}
                </span>
                <StatusPill status={e.status} label={e.status} />
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="font-mono text-xs text-faint text-center py-6 bg-surface border border-dashed border-line2 rounded-[14px]">
              No one&apos;s in yet — be the first.
            </div>
          )}
        </div>
      </section>

      {/* share */}
      <button
        onClick={() => {
          void navigator.clipboard.writeText(window.location.href);
          toast("Pool link copied — send it to your group chat.");
        }}
        className="mt-5 w-full font-mono text-xs text-muted hover:text-ink bg-surface border border-line2 rounded-[11px] py-3 cursor-pointer transition-colors"
      >
        Copy invite link
      </button>

      {/* enter sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Join pool">
        {pick && (
          <>
            <div className="flex items-center gap-3.5 mt-1.5 mb-4">
              <span className="font-bold text-[28px] leading-none text-home">{pick.label}</span>
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {marketLabel}
                </span>
                <span className="font-mono text-xs text-muted">
                  odds <b className="text-ink">{odds(pick.decimalOdds)}</b>
                </span>
              </span>
            </div>
            <div className="flex items-end justify-between gap-3 mb-4">
              <span className="flex flex-col gap-1">
                <span className="k">your bet</span>
                <b className="font-mono text-lg">{usdc(pool.stakeUsdc)}</b>
              </span>
              <span className="flex flex-col gap-1 text-right">
                <span className="k">prize if you win</span>
                <b className="font-mono text-lg text-home">{usdc(pot + pool.stakeUsdc)}</b>
              </span>
            </div>
            <button
              className="cta"
              disabled={!wallet.authenticated || enterPool.isPending}
              onClick={() => pick && enterPool.mutate(pick)}
            >
              {enterPool.isPending
                ? "Joining…"
                : wallet.authenticated
                  ? `Bet ${usdc(pool.stakeUsdc)} on ${pick.label}`
                  : "Log in to join"}
            </button>
            {/* The terms that change what you'd do: the fee and when it pays.
                Everything else was restating the screen above it. */}
            <p className="font-mono text-[10.5px] text-faint text-center mt-3">
              Winners split the prize, minus {pool.rakeBps / 100}% · settles on the
              90-minute result
            </p>
          </>
        )}
      </Sheet>

      {winOpen && pool.shareAmount != null && (
        <WinTakeover
          amount={Number(pool.shareAmount) / 1_000_000}
          optionLabel={viewerEntry?.optionLabel ?? winningOption?.label ?? "Your pick"}
          fixtureLabel={pool.fixtureLabel}
          claiming={payout.isPending}
          signature={viewerEntry?.claimTxSignature ?? null}
          onClaim={() => payout.mutate("claim")}
          onDismiss={() => {
            setWinOpen(false);
            setWinDismissed(true);
          }}
        />
      )}
    </div>
  );
}

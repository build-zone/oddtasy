"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePools } from "@/hooks/use-queries";
import { useProfile } from "@/hooks/use-profile";
import { useBalances, useWallet } from "@/hooks/use-wallet";
import { shortWallet, usdc } from "@/lib/format";
import { MyResult } from "@/components/my-result";
import type { PoolRecord } from "@/lib/types";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/toast";

function PoolRow({ pool }: { pool: PoolRecord }) {
  return (
    <Link
      href={`/pools/${pool.id}`}
      className="flex items-center gap-3 bg-surface border border-line2 rounded-[12px] px-3.5 py-3 transition-colors hover:border-[#33564a]"
    >
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold truncate">{pool.fixtureLabel}</span>
        <span className="font-mono text-[11px] text-muted truncate">
          {usdc(pool.stakeUsdc)} bet · {pool.entryCount} joined
          {pool.viewer?.optionLabel ? ` · you picked ${pool.viewer.optionLabel}` : ""}
        </span>
      </span>
      <MyResult pool={pool} />
    </Link>
  );
}

export default function MePage() {
  const wallet = useWallet();
  const toast = useToast();
  const { profile, update } = useProfile();
  const { data: balances } = useBalances(wallet.address);
  const { data: myPools } = usePools(
    wallet.address ? { wallet: wallet.address } : undefined,
  );
  const [name, setName] = useState("");
  useEffect(() => {
    if (profile) setName(profile.displayName);
  }, [profile]);

  // Your betting history, derived from the same pools list — split into what's
  // still running and what's already decided, with the record that answers the
  // only question a bettor actually has: am I up or down?
  const history = useMemo(() => {
    const pools = myPools ?? [];
    const isSettled = (p: PoolRecord) =>
      p.viewer?.status === "won" ||
      p.viewer?.status === "lost" ||
      p.viewer?.status === "refunded" ||
      p.status === "voided" ||
      p.status === "cancelled";

    const settled = pools.filter(isSettled);
    const live = pools.filter((p) => !isSettled(p));

    let won = 0;
    let net = 0;
    let unclaimed = 0;
    for (const p of settled) {
      const v = p.viewer;
      if (v?.status === "won") {
        won += 1;
        const share = p.shareAmount != null ? Number(p.shareAmount) / 1_000_000 : 0;
        net += share - p.stakeUsdc;
        if (!v.claimTxSignature) unclaimed += share;
      } else if (v?.status === "lost") {
        net -= p.stakeUsdc;
      }
      // voided/refunded: stake comes back, so it moves the record by nothing
    }
    return { live, settled, won, net, unclaimed };
  }, [myPools]);

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      toast("Name must be 2–32 characters.");
      return;
    }
    update.mutate(
      { displayName: trimmed },
      {
        onSuccess: () => toast("Name updated — the group sees it everywhere."),
        onError: (e) => toast(e instanceof Error ? e.message : "Couldn't save name"),
      },
    );
  };

  if (!wallet.authenticated) {
    return (
      <div className="pt-10 text-center fade-in">
        <h1 className="text-xl font-bold mb-2">Your locker room</h1>
        <p className="text-muted text-sm mb-6 max-w-[36ch] mx-auto">
          Email in, wallet handled. No seed phrases.
        </p>
        <button className="cta max-w-60 mx-auto" onClick={wallet.login} disabled={!wallet.enabled}>
          {wallet.enabled ? "Log in" : "Wallet not configured"}
        </button>
        {!wallet.enabled && (
          <p className="font-mono text-[10.5px] text-faint mt-3">
            Set NEXT_PUBLIC_PRIVY_APP_ID in web/.env.local to enable login.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="pt-2 fade-in">
      <div className="flex flex-col gap-3.5 bg-surface border border-line2 rounded-[14px] p-4 mb-5">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-[#10100a] shrink-0"
            style={{ background: "linear-gradient(135deg, var(--home), #c98f2a)" }}
          >
            {(profile?.displayName ?? wallet.email ?? "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold truncate">
              {profile?.displayName ?? "Fan"}
            </h2>
            <span className="font-mono text-[10.5px] text-faint block truncate">
              {wallet.email ?? "no email"} ·{" "}
              {wallet.address ? (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(wallet.address as string);
                    toast("Wallet address copied.");
                  }}
                  title={`${wallet.address} — click to copy`}
                  className="font-mono text-[10.5px] text-faint hover:text-ink cursor-pointer bg-transparent border-0 p-0 underline decoration-dotted underline-offset-2"
                >
                  {shortWallet(wallet.address)} ⧉
                </button>
              ) : (
                "no wallet"
              )}{" "}
              · devnet
            </span>
          </div>
          <button
            onClick={() => void wallet.logout()}
            className="ml-auto font-mono text-[11px] text-faint hover:text-ink cursor-pointer bg-transparent border-0 shrink-0"
          >
            log out
          </button>
        </div>

        <label className="flex items-center gap-2">
          <span className="k shrink-0">display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            className="flex-1 min-w-0 bg-surface2 border border-line2 rounded-lg px-3 py-2 font-mono text-xs text-ink outline-none focus:border-[#33564a]"
            placeholder="What the group calls you"
          />
          <button
            onClick={saveName}
            disabled={update.isPending || !profile || name.trim() === profile.displayName}
            className="shrink-0 font-mono text-[11px] font-semibold bg-home text-[#10100a] rounded-lg px-3.5 py-2 cursor-pointer transition-[filter] hover:brightness-105 disabled:bg-surface2 disabled:text-muted disabled:cursor-default"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </label>
        <div className="flex gap-2.5">
          <div className="flex-1 flex flex-col gap-1">
            <span className="k">usdc</span>
            <span className="font-mono font-semibold text-[15px]">
              {balances ? balances.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <span className="k">sol (fees)</span>
            <span className="font-mono font-semibold text-[15px]">
              {balances ? balances.sol.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <span className="k">pools</span>
            <span className="font-mono font-semibold text-[15px]">
              {myPools?.length ?? "—"}
            </span>
          </div>
        </div>
        {balances && balances.usdc === 0 && (
          <p className="font-mono text-[10.5px] text-faint leading-relaxed">
            You&apos;ll need devnet USDC to bet — grab some from{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="text-home underline underline-offset-4"
            >
              faucet.circle.com
            </a>{" "}
            (Solana devnet) and a little SOL from the devnet faucet for fees.
          </p>
        )}
      </div>

      {history.unclaimed > 0 && (
        <Link
          href={`/pools/${history.settled.find((p) => p.viewer?.status === "won" && !p.viewer.claimTxSignature)?.id ?? ""}`}
          className="flex items-center gap-3 bg-[#1b2a12] border border-[#3d5a24] rounded-[12px] px-3.5 py-3 mb-4 transition-colors hover:border-home"
        >
          <span className="flex-1">
            <span className="block text-[13.5px] font-semibold text-home">
              {usdc(history.unclaimed)} waiting for you
            </span>
            <span className="block font-mono text-[10.5px] text-muted mt-0.5">
              You won it — it&apos;s not in your wallet until you collect.
            </span>
          </span>
          <span className="shrink-0 font-mono text-[11px] font-semibold text-home">Collect →</span>
        </Link>
      )}

      {history.settled.length > 0 && (
        <>
          <p className="k mb-2.5">My record</p>
          <div className="flex gap-2.5 bg-surface border border-line2 rounded-[12px] px-3.5 py-3 mb-5">
            <span className="flex-1 flex flex-col gap-1">
              <span className="k">settled</span>
              <span className="font-mono font-semibold text-[15px]">{history.settled.length}</span>
            </span>
            <span className="flex-1 flex flex-col gap-1">
              <span className="k">won</span>
              <span className="font-mono font-semibold text-[15px]">
                {history.won}
                <span className="text-faint">/{history.settled.length}</span>
              </span>
            </span>
            <span className="flex-1 flex flex-col gap-1">
              <span className="k">net</span>
              <span
                className={`font-mono font-semibold text-[15px] ${
                  history.net > 0 ? "text-good" : history.net < 0 ? "text-loss" : "text-muted"
                }`}
              >
                {history.net > 0 ? "+" : history.net < 0 ? "−" : ""}
                {usdc(Math.abs(history.net))}
              </span>
            </span>
          </div>
        </>
      )}

      {history.live.length > 0 && (
        <>
          <p className="k mb-2.5">Still running</p>
          <div className="flex flex-col gap-2 mb-5">
            {history.live.map((p) => (
              <PoolRow key={p.id} pool={p} />
            ))}
          </div>
        </>
      )}

      {history.settled.length > 0 && (
        <>
          <p className="k mb-2.5">Settled</p>
          <div className="flex flex-col gap-2">
            {history.settled.map((p) => (
              <PoolRow key={p.id} pool={p} />
            ))}
          </div>
        </>
      )}

      {myPools && myPools.length === 0 && (
        <div className="font-mono text-xs text-faint text-center py-8 bg-surface border border-dashed border-line2 rounded-[14px]">
          Nothing yet — host or join a pool from any match.
        </div>
      )}
    </div>
  );
}

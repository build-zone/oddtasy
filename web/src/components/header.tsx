"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProfile } from "@/hooks/use-profile";
import { useBalances, useWallet } from "@/hooks/use-wallet";
import { shortWallet } from "@/lib/format";

const NAV = [
  { href: "/", label: "Matches" },
  { href: "/pools", label: "Pools" },
  { href: "/me", label: "Me" },
];

export function Header() {
  const wallet = useWallet();
  const { profile } = useProfile();
  const { data: balances } = useBalances(wallet.address);
  const pathname = usePathname();

  return (
    <header className="pt-4 pb-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
        <Link href="/" className="justify-self-start font-bold text-[clamp(16px,4.2vw,19px)] tracking-tight">
          Odd<span className="text-home">tasy</span>
        </Link>

        {/* balance pill, true-centered like Ranktasy's bank */}
        <div className="justify-self-center inline-flex items-center gap-[7px] font-mono bg-surface border border-line2 rounded-full py-[7px] pr-2 pl-3">
          <span
            className="w-[13px] h-[13px] rounded-full shrink-0"
            style={{
              background: "radial-gradient(circle at 35% 30%, #ffe08a, var(--home))",
              boxShadow: "0 0 0 1px #00000022 inset",
            }}
          />
          <b className="font-semibold text-sm">
            {wallet.address && balances
              ? balances.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : "—"}
          </b>
          <span className="k">usdc</span>
        </div>

        <div className="justify-self-end flex items-center gap-2">
          {wallet.authenticated && wallet.address ? (
            <Link
              href="/me"
              className="inline-flex items-center gap-2 font-mono text-[11px] text-muted hover:text-ink bg-surface border border-line2 rounded-full py-1.5 pl-1.5 pr-3 transition-colors"
              title="Your account"
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-[#10100a] shrink-0"
                style={{ background: "linear-gradient(135deg, var(--home), #c98f2a)" }}
              >
                {(profile?.displayName ?? wallet.address).slice(0, 2).toUpperCase()}
              </span>
              {profile?.displayName ?? shortWallet(wallet.address)}
            </Link>
          ) : (
            <button
              onClick={wallet.login}
              disabled={!wallet.enabled}
              className="font-mono text-[11px] font-semibold bg-home text-[#10100a] rounded-full px-4 py-2 transition-[filter] hover:brightness-105 disabled:bg-surface2 disabled:text-muted cursor-pointer disabled:cursor-default"
              title={wallet.enabled ? "Log in" : "Set NEXT_PUBLIC_PRIVY_APP_ID to enable login"}
            >
              {wallet.enabled ? "Log in" : "No wallet"}
            </button>
          )}
        </div>
      </div>

      <nav className="flex gap-1 mt-3">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`font-mono text-xs rounded-lg px-3.5 py-2 transition-colors ${
                active
                  ? "bg-surface2 text-ink shadow-[inset_0_0_0_1px_var(--line2)]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

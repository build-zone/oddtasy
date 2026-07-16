"use client";

import { usePathname } from "next/navigation";

/**
 * The honesty line — real data, fake money, not a real bookmaker.
 *
 * It used to run four lines on every screen, including over the top of a live
 * match and a payout. All three facts still matter, so none are dropped; they
 * just say it once, in one line, on the two screens where someone is actually
 * reading rather than watching.
 */
export function SiteFooter() {
  const pathname = usePathname();
  const show = pathname === "/" || pathname === "/me";
  if (!show) return null;

  return (
    <footer className="font-mono text-[10px] leading-relaxed text-faint text-center mt-8">
      <b className="text-muted font-medium">Real TxLINE data</b> · devnet USDC ·
      not a licensed bookmaker
    </footer>
  );
}

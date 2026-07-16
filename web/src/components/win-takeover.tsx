"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The payout moment.
 *
 * Everywhere else in Oddtasy a state is a card — same surface, same border,
 * same 14px radius. That is right for scanning and wrong for winning, so the
 * win gets the one thing the rest of the product never does: the whole
 * viewport, a single light source, and one affordance.
 *
 * The lighting vocabulary is deliberately `live-stage.tsx` — the match stage
 * dims down into the money stage, so the win reads as the same product
 * finishing its own sentence rather than a bolted-on confetti screen.
 */

type Phase = "dark" | "bloom" | "count" | "settled" | "paid";

export function WinTakeover({
  amount,
  optionLabel,
  fixtureLabel,
  claiming,
  signature,
  onClaim,
  onDismiss,
}: {
  /** Winnings in whole USDC. The hero — the only number on screen. */
  amount: number;
  /** What they backed, e.g. "Over 2.5". */
  optionLabel: string;
  fixtureLabel: string;
  claiming: boolean;
  /** Set once the claim tx confirms — flips the stage to its resting state. */
  signature: string | null;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("dark");
  const [shown, setShown] = useState(0);
  const reduced = usePrefersReducedMotion();
  const bodyRef = useRef<HTMLDivElement>(null);

  // The arc: hold in the dark, bloom the light, count the money, rest.
  // Reduced motion gets the destination without the journey.
  useEffect(() => {
    if (reduced) {
      setPhase("settled");
      setShown(amount);
      return;
    }
    const timers = [
      setTimeout(() => setPhase("bloom"), 220),
      setTimeout(() => setPhase("count"), 760),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced, amount]);

  // Count-up. Ease-out cubic so it decelerates into the final figure rather
  // than stopping dead — the number should feel like it lands.
  useEffect(() => {
    if (phase !== "count") return;
    const DUR = 1100;
    let raf = 0;
    let start: number | null = null;
    const tick = (t: number) => {
      start ??= t;
      const p = Math.min(1, (t - start) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(amount * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setPhase("settled");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, amount]);

  useEffect(() => {
    if (signature) setPhase("paid");
  }, [signature]);

  // A takeover that traps you is a bug, not a moment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog for screen readers, but onto the container —
    // focusing the close button rings the one control we least want looked at.
    bodyRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onDismiss]);

  const lit = phase !== "dark";
  const paid = phase === "paid";

  return (
    <div
      className={`win-stage${lit ? " lit" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`You won ${fmt(amount)}`}
    >
      <div className="win-rays" aria-hidden="true" />
      <div className="win-vignette" aria-hidden="true" />

      <button className="win-close" onClick={onDismiss} aria-label="Close">
        ✕
      </button>

      <div className="win-body" ref={bodyRef} tabIndex={-1}>
        <p className="win-kicker">{paid ? "paid out" : "you won"}</p>

        {/* The hero. Nothing else on this screen is allowed to compete. */}
        <p className="win-amount" aria-live="polite">
          {fmt(phase === "settled" || paid ? amount : shown)}
        </p>

        <p className="win-sub">
          <b>{optionLabel}</b> came in · {fixtureLabel}
        </p>

        {!paid && (
          <button className="win-cta" disabled={claiming} onClick={onClaim}>
            {claiming ? "Paying you…" : "Collect it"}
          </button>
        )}

        {paid && (
          <>
            <p className="win-paid">✓ Sent to your wallet</p>
            <p className="win-sig">{signature?.slice(0, 12)}…</p>
            <button className="win-ghost" onClick={onDismiss}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Money, hero-sized: cents only while counting, whole dollars at rest. */
function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

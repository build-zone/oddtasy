"use client";

import { useMemo } from "react";
import {
  heatColor,
  scoreMatrix,
  smoothPath,
  totalBins,
  totalLabel,
  totalsFromMatrix,
} from "@/lib/dixon-coles";
import type { FixtureLambdas } from "@/lib/priors";

/**
 * Ranktasy's goals-distribution chart: discrete bars are the real numbers,
 * the spline is a smoothing overlay only. Model view, labeled as such.
 */
export function GoalsChart({ lambdas }: { lambdas: FixtureLambdas }) {
  const { bars, spline, axis } = useMemo(() => {
    const M = scoreMatrix(lambdas.homeLambda, lambdas.awayLambda, lambdas.rho);
    const bins = totalBins(totalsFromMatrix(M));
    const pmax = Math.max(...bins);
    const W = 700;
    const BASE = 170;
    const MAXBARH = 140;
    const SLOT = W / bins.length;
    const pts: [number, number][] = [];
    const bars = bins.map((p, idx) => {
      const bh = pmax > 0 ? (p / pmax) * MAXBARH : 0;
      const x = idx * SLOT + SLOT * 0.22;
      const w = SLOT * 0.56;
      const y = BASE - bh;
      const cx = idx * SLOT + SLOT / 2;
      pts.push([cx, y]);
      return { x, w, y, bh, cx, p, color: heatColor(p, pmax) };
    });
    return {
      bars,
      spline: smoothPath(pts),
      axis: bins.map((_, idx) => totalLabel(idx)),
    };
  }, [lambdas]);

  return (
    <div>
      <svg viewBox="0 0 700 190" className="w-full h-auto block overflow-visible my-1" aria-hidden>
        {bars.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={b.y} width={b.w} height={b.bh} rx={5} fill={b.color} />
            <text
              x={b.cx}
              y={Math.max(16, b.y - 8)}
              textAnchor="middle"
              fill="var(--ink)"
              style={{ fontFamily: "var(--font-plex)", fontSize: 15, fontWeight: 600 }}
            >
              {(b.p * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        <path
          d={spline}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
      </svg>
      <div className="flex">
        {axis.map((label) => (
          <span key={label} className="flex-1 text-center k !text-[10px] normal-case">
            {label}
          </span>
        ))}
      </div>
      <p className="font-mono text-[10px] text-faint text-center mt-3 leading-relaxed">
        chance the match ends with this many total goals · model view
      </p>
    </div>
  );
}

export function AttributionLine({
  homeName,
  awayName,
  lambdas,
}: {
  homeName: string;
  awayName: string;
  lambdas: FixtureLambdas;
}) {
  return (
    <p className="font-mono text-[10.5px] text-faint text-center mt-4 leading-relaxed">
      <b className="text-muted font-semibold">{homeName}</b> λ {lambdas.homeLambda.toFixed(2)} ·{" "}
      <b className="text-muted font-semibold">{awayName}</b> λ {lambdas.awayLambda.toFixed(2)} ·
      Dixon–Coles ρ = {lambdas.rho.toFixed(2)} — model prices are seeded priors, not fitted;
      TxLINE market prices override them where a book exists.
    </p>
  );
}

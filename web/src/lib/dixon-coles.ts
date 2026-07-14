/**
 * Dixon–Coles core — identical formulas to Ranktasy's frozen engine (proven by
 * its 113-check parity suite). Client-side copy exists only for the analysis
 * visuals (goals distribution); market pricing stays server-side.
 */
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];
const fact = (n: number) => FACT[n] ?? Infinity;
const poisson = (k: number, l: number) => (Math.exp(-l) * Math.pow(l, k)) / fact(k);

export const MAXG = 8;
export const TOTAL_CAP = 6;

export function scoreMatrix(lh: number, la: number, rho: number): number[][] {
  const M: number[][] = [];
  for (let i = 0; i <= MAXG; i++) {
    M[i] = [];
    for (let j = 0; j <= MAXG; j++) M[i][j] = poisson(i, lh) * poisson(j, la);
  }
  const tau = (x: number, y: number) => {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  };
  for (let i = 0; i <= 1; i++) for (let j = 0; j <= 1; j++) M[i][j] *= tau(i, j);
  let s = 0;
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) s += M[i][j];
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) M[i][j] /= s;
  return M;
}

export function totalsFromMatrix(M: number[][]): number[] {
  const T = new Array(2 * MAXG + 1).fill(0) as number[];
  for (let i = 0; i < M.length; i++)
    for (let j = 0; j < M[i].length; j++) T[i + j] += M[i][j];
  return T;
}

export function totalBins(T: number[], cap = TOTAL_CAP): number[] {
  const bins = new Array(cap + 1).fill(0) as number[];
  for (let t = 0; t < T.length; t++) bins[Math.min(t, cap)] += T[t];
  return bins;
}

export const totalLabel = (n: number, cap = TOTAL_CAP) => (n >= cap ? `${cap}+` : String(n));

/** Smooth silhouette through bar-top points — styling only, not data. */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` T ${last[0]},${last[1]}`;
  return d;
}

/** Ranktasy heat spectrum: green = most likely → red = least likely. */
export function heatColor(p: number, pmax: number): string {
  if (pmax <= 0) return "rgb(23,44,35)";
  const u = 1 - Math.min(1, p / pmax);
  const stops: [number, [number, number, number]][] = [
    [0, [45, 212, 110]],
    [0.4, [250, 219, 65]],
    [0.7, [255, 149, 33]],
    [1, [250, 66, 66]],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let k = 0; k < stops.length - 1; k++) {
    if (u >= stops[k][0] && u <= stops[k + 1][0]) {
      a = stops[k];
      b = stops[k + 1];
      break;
    }
  }
  const f = (u - a[0]) / (b[0] - a[0] || 1);
  const c = [0, 1, 2].map((n) => Math.round(a[1][n] + (b[1][n] - a[1][n]) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

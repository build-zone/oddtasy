/**
 * Team-strength ratings — expected goals vs an average opponent.
 *
 * FITTED FROM REAL RESULTS, not hand-set. An opponent-adjusted Poisson
 * attack/defence model over 5,313 international matches (2021-07 → 2026-07,
 * source: martj42/international_results), with a 2-year recency half-life and
 * small-sample shrinkage, rescaled multiplicatively onto this model's operating
 * mean (every team-vs-team ratio is exactly what the data says). Regenerate
 * with scripts/fit-ratings.mjs — the numbers below are pure fit output, no
 * hand-tuning. Covers all 48 teams in the 2026 field.
 *
 * These give every fixture an analysis to show; real TxLINE prices still
 * override wherever a live book exists (hybrid source).
 */
import { awayTeam, homeTeam, type OddtasyFixture } from "./types";

export const DIXON_COLES_RHO = -0.1;
// Field mean of the fitted ratings — the "average opponent" the ratings and the
// damping below are centred on. Also the fallback for any unrated team.
const DEFAULT_LAMBDA = 1.3;

const TEAM_LAMBDA: Record<string, number> = {
  brazil: 2.26,
  france: 2.13,
  spain: 2.33,
  argentina: 2.24,
  england: 1.93,
  germany: 2.12,
  portugal: 2.02,
  netherlands: 2.07,
  belgium: 1.89,
  italy: 1.52,
  colombia: 1.9,
  usa: 1.23,
  "united states": 1.23,
  uruguay: 1.3,
  switzerland: 1.75,
  croatia: 1.61,
  denmark: 1.52,
  morocco: 1.44,
  mexico: 1.41,
  senegal: 1.65,
  ukraine: 1.48,
  "czech republic": 1.27,
  "ivory coast": 1.19,
  algeria: 1.6,
  nigeria: 1.43,
  turkey: 1.6,
  türkiye: 1.6,
  "south korea": 1.25,
  norway: 1.89,
  poland: 1.19,
  japan: 1.63,
  sweden: 1.6,
  austria: 1.47,
  canada: 1.21,
  chile: 1.31,
  cameroon: 1.01,
  egypt: 1.19,
  serbia: 1.18,
  ecuador: 1.13,
  australia: 1.21,
  "south africa": 0.89,
  ghana: 0.96,
  peru: 0.88,
  scotland: 1.28,
  paraguay: 1.12,
  wales: 1.03,
  iran: 1.33,
  tunisia: 1.0,
  venezuela: 1.23,
  "costa rica": 0.95,
  jamaica: 0.66,
  "saudi arabia": 0.83,
  panama: 1.04,
  "new zealand": 0.81,
  bosnia: 0.93,
  "bosnia and herzegovina": 0.93,
  // TxLINE spells it with an ampersand — without this alias the rating above
  // never matches and Bosnia silently defaults to DEFAULT_LAMBDA.
  "bosnia & herzegovina": 0.93,
  "congo dr": 1.03,
  iraq: 0.83,
  qatar: 0.87,
  honduras: 0.7,
  bolivia: 0.9,
  jordan: 1.21,
  haiti: 1.07,
  "cape verde": 0.96,
  uzbekistan: 0.96,
  curacao: 0.7,
  vietnam: 0.62,
  india: 0.41,
  myanmar: 0.46,
};

export function teamLambda(name: string): number {
  return TEAM_LAMBDA[name.trim().toLowerCase()] ?? DEFAULT_LAMBDA;
}

/** Whether the model actually has a rating for this team, or is about to fall
 * back to DEFAULT_LAMBDA. A defaulted side means the "model" price is a neutral
 * placeholder, not a read on the team — the caller should say so rather than
 * render it as a confident number. */
export function isTeamRated(name: string): boolean {
  return TEAM_LAMBDA[name.trim().toLowerCase()] != null;
}

export type ModelCoverage = {
  homeRated: boolean;
  awayRated: boolean;
  /** Both sides unrated: the forecast is a pure default, worth the loudest caveat. */
  bothDefaulted: boolean;
  /** At least one side unrated: the matchup is partly guesswork. */
  anyDefaulted: boolean;
};

export function modelCoverage(fixture: OddtasyFixture): ModelCoverage {
  const homeRated = isTeamRated(homeTeam(fixture));
  const awayRated = isTeamRated(awayTeam(fixture));
  return {
    homeRated,
    awayRated,
    bothDefaulted: !homeRated && !awayRated,
    anyDefaulted: !homeRated || !awayRated,
  };
}

export type FixtureLambdas = { homeLambda: number; awayLambda: number; rho: number };

// AVG matches the fitted field mean (see DEFAULT_LAMBDA) so the damping is
// centred: a match between two average-rated teams leaves both λ unchanged.
const AVG = 1.3;
const DAMP = 0.45;
const clamp = (x: number) => Math.min(3.2, Math.max(0.3, x));

/** Ratings are "goals vs an average opponent", so each side's rate is damped
 * by the opponent's strength — a strong opponent suppresses your λ, a weak
 * one lifts it. Gives a matchup-dependent feel without hand-setting
 * per-fixture priors across 104 fixtures. */
export function fixtureLambdas(fixture: OddtasyFixture): FixtureLambdas {
  const rh = teamLambda(homeTeam(fixture));
  const ra = teamLambda(awayTeam(fixture));
  return {
    homeLambda: clamp(rh * Math.pow(AVG / ra, DAMP)),
    awayLambda: clamp(ra * Math.pow(AVG / rh, DAMP)),
    rho: DIXON_COLES_RHO,
  };
}

/**
 * Seeded team-strength priors (expected goals vs an average opponent):
 * NOT fitted to this tournament, treat as illustrative. They exist so every
 * market always has an analysis to show —
 * real TxLINE prices override them wherever a book exists (hybrid source).
 */
import { awayTeam, homeTeam, type OddtasyFixture } from "./types";

export const DIXON_COLES_RHO = -0.1;
const DEFAULT_LAMBDA = 1.2;

const TEAM_LAMBDA: Record<string, number> = {
  brazil: 2.25,
  france: 2.2,
  spain: 2.15,
  argentina: 2.1,
  england: 2.1,
  germany: 2.0,
  portugal: 1.95,
  netherlands: 1.95,
  belgium: 1.8,
  italy: 1.7,
  colombia: 1.65,
  usa: 1.65,
  "united states": 1.65,
  uruguay: 1.6,
  switzerland: 1.6,
  croatia: 1.5,
  denmark: 1.5,
  morocco: 1.5,
  mexico: 1.45,
  senegal: 1.4,
  ukraine: 1.4,
  "czech republic": 1.4,
  "ivory coast": 1.4,
  algeria: 1.35,
  nigeria: 1.35,
  turkey: 1.35,
  türkiye: 1.35,
  "south korea": 1.3,
  norway: 1.3,
  poland: 1.3,
  japan: 1.25,
  sweden: 1.25,
  austria: 1.25,
  canada: 1.25,
  chile: 1.2,
  cameroon: 1.2,
  egypt: 1.2,
  serbia: 1.2,
  ecuador: 1.15,
  australia: 1.15,
  "south africa": 1.15,
  ghana: 1.15,
  peru: 1.1,
  scotland: 1.1,
  paraguay: 1.05,
  wales: 1.05,
  iran: 1.05,
  tunisia: 1.05,
  venezuela: 1.0,
  "costa rica": 0.95,
  jamaica: 0.95,
  "saudi arabia": 0.9,
  panama: 0.9,
  "new zealand": 0.9,
  bosnia: 0.9,
  "bosnia and herzegovina": 0.9,
  // TxLINE spells it with an ampersand — without this alias the rating above
  // never matches and Bosnia silently defaults to λ=1.2.
  "bosnia & herzegovina": 0.9,
  "congo dr": 0.9,
  iraq: 0.9,
  qatar: 0.85,
  honduras: 0.8,
  bolivia: 0.8,
  jordan: 0.75,
  haiti: 0.75,
  "cape verde": 0.7,
  uzbekistan: 0.7,
  curacao: 0.7,
  vietnam: 0.65,
  india: 0.55,
  myanmar: 0.5,
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

const AVG = 1.2;
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

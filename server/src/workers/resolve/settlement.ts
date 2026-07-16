/**
 * settlement.ts — pure settlement logic. No chain, no DB, no I/O.
 *
 * This is the money-mapping layer: given a TxLINE final phase and score, what
 * does the pool resolve to. Kept pure so it can be unit-tested in isolation
 * (see settlement.test.ts). The two things most likely to be wrong in a payout
 * live here, so they are the two things that get tested hardest.
 */

// ---- TxLINE game-phase routing (adapter spec 6.3) ----

export type PhaseAction = "resolve" | "cancel" | "hold" | "none";

/**
 * Map a TxLINE soccer game-phase code to a settlement action.
 *   resolve: F(5), FET(10), FPE(13)          -> the match is over, settle
 *   cancel : A(15), C(16), TXCC(17), P(19)   -> abandoned/postponed, refund
 *   hold   : I(14), TXCS(18)                  -> interrupted/suspended, wait
 *   none   : everything in-progress or not started
 *
 * "final" is three codes, not one: a knockout that goes to penalties ends on 13.
 */
export function phaseAction(phaseCode: number): PhaseAction {
  switch (phaseCode) {
    case 5:
    case 10:
    case 13:
      return "resolve";
    case 15:
    case 16:
    case 17:
    case 19:
      return "cancel";
    case 14:
    case 18:
      return "hold";
    default:
      return "none";
  }
}

// ---- market outcome encoding ----
// The on-chain program is market-agnostic: an outcome is just an index < outcome_count.
// These encodings MUST match how the client records a member's pick. If the client
// and this file disagree, winners are mis-identified. Keep them in one shared source.

export const MARKET = {
  MATCH_RESULT: 0, // 1X2, outcome_count 3
  OVER_UNDER: 1, // outcome_count 2
  CORRECT_SCORE: 2, // folded exact-score grid; cap travels in market_param
} as const;

export interface Score {
  home: number;
  away: number;
}

/** Grid fold: goals >=4 collapse into a "4+" bucket by default. */
export const DEFAULT_CS_CAP = 4;
export function correctScoreIndex(home: number, away: number, cap = DEFAULT_CS_CAP): number {
  const h = Math.min(home, cap);
  const a = Math.min(away, cap);
  return h * (cap + 1) + a;
}

/**
 * The winning outcome index for a market, given the settling score.
 *  - MATCH_RESULT: 0 home, 1 draw, 2 away
 *  - OVER_UNDER:   0 under, 1 over. market_param is the line * 10 (2.5 -> 25).
 *                  Half-integer lines never push.
 *  - CORRECT_SCORE: folded (home,away) index. market_param is the cap
 *                   (4 => 0,1,2,3,4+).
 */
export function winningOutcome(marketType: number, marketParam: number, score: Score): number {
  switch (marketType) {
    case MARKET.MATCH_RESULT:
      if (score.home > score.away) return 0;
      if (score.home === score.away) return 1;
      return 2;
    case MARKET.OVER_UNDER: {
      const line = marketParam / 10;
      const total = score.home + score.away;
      return total > line ? 1 : 0;
    }
    case MARKET.CORRECT_SCORE:
      return correctScoreIndex(score.home, score.away, marketParam > 0 ? marketParam : DEFAULT_CS_CAP);
    default:
      throw new Error(`unknown market_type ${marketType}`);
  }
}

// ---- 90-minute regulation score from TxLINE stat keys (adapter spec 6.4, 9.1) ----

/**
 * The regulation (first-half + second-half) score, excluding extra time and
 * penalties. All MVP markets settle on this so knockout ET/penalties don't skew
 * a 1X2 pool that was priced on 90 minutes.
 *
 * Keys: (period*1000)+base. 1001/1002 = P1/P2 first-half goals,
 *       2001/2002 = P1/P2 second-half goals.
 *
 * WARNING: assumes participant1 = home, participant2 = away. This is adapter-spec
 * OQ-A, the single highest-risk mapping. Confirm against a known finished fixture
 * before trusting any payout.
 */
export function regulationScore(stats: Record<string, number>): Score {
  const g = (k: string) => stats[k] ?? 0;
  return {
    home: g("1001") + g("2001"),
    away: g("1002") + g("2002"),
  };
}

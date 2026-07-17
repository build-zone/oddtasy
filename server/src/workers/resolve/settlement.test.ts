/**
 * settlement.test.ts — unit tests for the pure money-mapping logic.
 *
 * Zero-dependency: uses Node's built-in test runner. Run with:
 *   npx tsx --test settlement.test.ts        (if you use tsx)
 *   or compile to JS and: node --test
 *
 * If your backend uses jest/vitest, the assertions translate 1:1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phaseAction,
  winningOutcome,
  correctScoreIndex,
  regulationScore,
  MARKET,
} from "./settlement.js";

test("phase codes route to the right settlement action", () => {
  for (const c of [5, 10, 13]) assert.equal(phaseAction(c), "resolve"); // F, FET, FPE
  for (const c of [15, 16, 17, 19]) assert.equal(phaseAction(c), "cancel"); // A, C, TXCC, P
  for (const c of [14, 18]) assert.equal(phaseAction(c), "hold"); // I, TXCS
  for (const c of [1, 2, 3, 4, 6, 7, 8, 9, 11, 12]) assert.equal(phaseAction(c), "none");
});

test("1X2 resolves home/draw/away", () => {
  assert.equal(winningOutcome(MARKET.MATCH_RESULT, 0, { home: 2, away: 1 }), 0);
  assert.equal(winningOutcome(MARKET.MATCH_RESULT, 0, { home: 1, away: 1 }), 1);
  assert.equal(winningOutcome(MARKET.MATCH_RESULT, 0, { home: 0, away: 3 }), 2);
});

test("over/under settles against the line (param = line*10)", () => {
  // line 2.5 -> param 25; half-integer lines never push
  assert.equal(winningOutcome(MARKET.OVER_UNDER, 25, { home: 2, away: 1 }), 1); // total 3, over
  assert.equal(winningOutcome(MARKET.OVER_UNDER, 25, { home: 1, away: 1 }), 0); // total 2, under
  // line 3.5 -> param 35
  assert.equal(winningOutcome(MARKET.OVER_UNDER, 35, { home: 2, away: 1 }), 0); // total 3, under
});

test("correct-score folds the 4+ tail by default", () => {
  assert.equal(correctScoreIndex(2, 1), 2 * 5 + 1); // 11
  assert.equal(correctScoreIndex(0, 0), 0);
  assert.equal(correctScoreIndex(7, 0), 4 * 5 + 0); // 7 folds to 4+ -> 20
  assert.equal(correctScoreIndex(3, 9), 3 * 5 + 4); // 9 folds to 4+ -> 19
  assert.equal(
    winningOutcome(MARKET.CORRECT_SCORE, 0, { home: 2, away: 2 }),
    correctScoreIndex(2, 2),
  );
  assert.equal(
    winningOutcome(MARKET.CORRECT_SCORE, 5, { home: 7, away: 0 }),
    correctScoreIndex(7, 0, 5),
  );
});

test("BTTS: yes only when both sides score (0 no, 1 yes)", () => {
  assert.equal(winningOutcome(MARKET.BTTS, 0, { home: 2, away: 1 }), 1); // both scored -> yes
  assert.equal(winningOutcome(MARKET.BTTS, 0, { home: 1, away: 1 }), 1); // both scored -> yes
  assert.equal(winningOutcome(MARKET.BTTS, 0, { home: 3, away: 0 }), 0); // away blank -> no
  assert.equal(winningOutcome(MARKET.BTTS, 0, { home: 0, away: 0 }), 0); // goalless -> no
});

test("odd/even settles on total goals (0 even, 1 odd; 0-0 is even)", () => {
  assert.equal(winningOutcome(MARKET.ODD_EVEN, 0, { home: 2, away: 1 }), 1); // total 3 -> odd
  assert.equal(winningOutcome(MARKET.ODD_EVEN, 0, { home: 1, away: 1 }), 0); // total 2 -> even
  assert.equal(winningOutcome(MARKET.ODD_EVEN, 0, { home: 0, away: 0 }), 0); // total 0 -> even
  assert.equal(winningOutcome(MARKET.ODD_EVEN, 0, { home: 3, away: 0 }), 1); // total 3 -> odd
});

test("regulation score sums first + second half per side", () => {
  // home = P1 (1001+2001), away = P2 (1002+2002)
  const stats = { "1001": 1, "2001": 1, "1002": 0, "2002": 1 };
  assert.deepEqual(regulationScore(stats), { home: 2, away: 1 });
});

test("regulation score ignores extra-time and penalty keys", () => {
  // Only H1/H2 keys count; ET (3001/4001) and penalties (5001) are excluded.
  const stats = { "1001": 1, "2001": 0, "1002": 1, "2002": 0, "3001": 1, "5001": 3 };
  assert.deepEqual(regulationScore(stats), { home: 1, away: 1 }); // a 90-min draw
});

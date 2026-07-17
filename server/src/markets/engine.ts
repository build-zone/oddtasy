import { config } from "../config.js";
import type { OddtasyMarket } from "../txline/types.js";
import { normalizedOutcomeKey, parseMarketParameters } from "../txline/format-market.js";
import { MARKET, type ModelInput, type SocialMarket, type SocialOption } from "./types.js";

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];
const MAXG = 8;
const DEFAULT_RHO = -0.1;
const DEFAULT_OU_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];

function fact(n: number): number {
  return FACT[n] ?? Infinity;
}

function poisson(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact(k);
}

export function scoreMatrix(homeLambda: number, awayLambda: number, rho = DEFAULT_RHO): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i <= MAXG; i++) {
    matrix[i] = [];
    for (let j = 0; j <= MAXG; j++) {
      matrix[i]![j] = poisson(i, homeLambda) * poisson(j, awayLambda);
    }
  }

  const tau = (x: number, y: number) => {
    if (x === 0 && y === 0) return 1 - homeLambda * awayLambda * rho;
    if (x === 0 && y === 1) return 1 + homeLambda * rho;
    if (x === 1 && y === 0) return 1 + awayLambda * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  };

  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      matrix[i]![j] = matrix[i]![j]! * tau(i, j);
    }
  }

  let total = 0;
  for (const row of matrix) {
    for (const p of row) total += p;
  }
  for (const row of matrix) {
    for (let j = 0; j < row.length; j++) row[j] = row[j]! / total;
  }
  return matrix;
}

export function foldMatrix(matrix: number[][], cap: number): number[][] {
  const folded = Array.from({ length: cap + 1 }, () => Array(cap + 1).fill(0) as number[]);
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      folded[Math.min(i, cap)]![Math.min(j, cap)]! += row[j]!;
    }
  }
  return folded;
}

export function outcomeProbabilities(matrix: number[][]): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      const p = matrix[i]![j]!;
      if (i > j) home += p;
      else if (i < j) away += p;
      else draw += p;
    }
  }
  return { home, draw, away };
}

export function totalsFromMatrix(matrix: number[][]): number[] {
  const totals = new Array(2 * MAXG + 1).fill(0) as number[];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      totals[i + j]! += matrix[i]![j]!;
    }
  }
  return totals;
}

function overUnder(totals: number[], line: number): { over: number; under: number } {
  let over = 0;
  for (let totalGoals = 0; totalGoals < totals.length; totalGoals++) {
    if (totalGoals > line) over += totals[totalGoals]!;
  }
  return { over, under: 1 - over };
}

/**
 * Both teams to score. "Yes" is every cell where BOTH sides score at least one
 * (home>=1 AND away>=1); the tau-corrected 0-0/1-0/0-1/1-1 cells are exactly the
 * low-scoring block this depends on, so it reads straight off the same matrix.
 */
function bothTeamsToScore(matrix: number[][]): { yes: number; no: number } {
  let yes = 0;
  for (let i = 1; i < matrix.length; i++) {
    for (let j = 1; j < matrix[i]!.length; j++) yes += matrix[i]![j]!;
  }
  return { yes, no: 1 - yes };
}

/** Odd vs even total goals. 0 goals counts as even (standard bookmaker rule). */
function oddEven(totals: number[]): { odd: number; even: number } {
  let even = 0;
  for (let totalGoals = 0; totalGoals < totals.length; totalGoals++) {
    if (totalGoals % 2 === 0) even += totals[totalGoals]!;
  }
  return { even, odd: 1 - even };
}

function fairOdds(probability: number): number {
  return Number((1 / Math.max(probability, 1e-6)).toFixed(2));
}

function probabilityOption(params: {
  prediction: number;
  key: string;
  label: string;
  probability: number;
}): SocialOption {
  return {
    prediction: params.prediction,
    key: params.key,
    label: params.label,
    probability: params.probability,
    decimalOdds: fairOdds(params.probability),
    impliedPct: params.probability,
    multiplier: fairOdds(params.probability),
    priceSource: "model_fair",
  };
}

function txlineOption(params: {
  prediction: number;
  key: string;
  label: string;
  decimalOdds: number;
  impliedPct: number;
  multiplier: number;
  txLineMessageId: string;
}): SocialOption {
  return {
    prediction: params.prediction,
    key: params.key,
    label: params.label,
    decimalOdds: params.decimalOdds,
    impliedPct: params.impliedPct,
    multiplier: params.multiplier,
    priceSource: "txline",
    txLineMessageId: params.txLineMessageId,
  };
}

function emptyOption(prediction: number, key: string, label: string): SocialOption {
  return {
    prediction,
    key,
    label,
    priceSource: "unpriced",
  };
}

function isFullTime(market: OddtasyMarket): boolean {
  // TxLINE often sends null for full-time match markets (serialized as null, not "FT").
  const period = String(market.marketPeriod ?? "")
    .trim()
    .toUpperCase();
  return !period || period === "FT" || period === "NULL" || period === "FULLTIME" || period === "FULL_TIME";
}

function isMatchResult(market: OddtasyMarket): boolean {
  const type = market.superOddsType.trim().toUpperCase();
  // Live feed uses 1X2_PARTICIPANT_RESULT; older samples may use 1X2 / 1X2_PARTICIPANT.
  return (
    isFullTime(market) &&
    (type === "1X2" ||
      type === "MATCH_RESULT" ||
      type === "1X2_PARTICIPANT" ||
      type.startsWith("1X2_PARTICIPANT"))
  );
}

function isOverUnder(market: OddtasyMarket): boolean {
  const type = market.superOddsType.trim().toUpperCase();
  return isFullTime(market) && (type.includes("OVERUNDER") || type.includes("OVER_UNDER"));
}

function isCorrectScore(market: OddtasyMarket): boolean {
  return isFullTime(market) && market.superOddsType.trim().toUpperCase().includes("CORRECT_SCORE");
}

function predictionFor1x2(key: string): number | undefined {
  switch (normalizedOutcomeKey(key)) {
    case "1":
    case "HOME":
    case "H":
    case "PARTICIPANT1":
    case "PART1":
    case "P1":
      return 0;
    case "X":
    case "DRAW":
    case "D":
      return 1;
    case "2":
    case "AWAY":
    case "A":
    case "PARTICIPANT2":
    case "PART2":
    case "P2":
      return 2;
    default:
      return undefined;
  }
}

function predictionForOverUnder(key: string): number | undefined {
  const normalized = normalizedOutcomeKey(key);
  if (normalized.includes("UNDER")) return 0;
  if (normalized.includes("OVER")) return 1;
  return undefined;
}

function scoreLabel(i: number, j: number, cap: number): string {
  const gl = (n: number) => (n >= cap ? `${cap}+` : String(n));
  return `${gl(i)}-${gl(j)}`;
}

export function correctScorePrediction(home: number, away: number, cap = config.correctScoreCap): number {
  const width = cap + 1;
  return Math.min(home, cap) * width + Math.min(away, cap);
}

function txlineMatchResult(markets: OddtasyMarket[]): SocialMarket | null {
  const market = markets.find(isMatchResult);
  if (!market) return null;

  const options = market.outcomes
    .map((outcome) => {
      const prediction = predictionFor1x2(outcome.key);
      if (prediction == null) return null;
      return txlineOption({
        prediction,
        key: outcome.key,
        label: outcome.label,
        decimalOdds: outcome.decimalOdds,
        impliedPct: outcome.impliedPct,
        multiplier: outcome.multiplier,
        txLineMessageId: market.txLineMessageId,
      });
    })
    .filter((option): option is SocialOption => option != null)
    .sort((a, b) => a.prediction - b.prediction);

  if (options.length !== 3) return null;
  return {
    marketType: MARKET.MATCH_RESULT,
    marketKey: "match_result",
    label: "Match Result",
    marketParam: 0,
    outcomeCount: 3,
    options,
    dataNote: "TxLINE full-time 1X2 market mapped to program predictions: 0 home, 1 draw, 2 away.",
  };
}

function txlineOverUnder(markets: OddtasyMarket[]): SocialMarket[] {
  const out: SocialMarket[] = [];
  for (const market of markets.filter(isOverUnder)) {
    const parsed = parseMarketParameters(market.marketParameters);
    const line = parsed.line ? Number(parsed.line) : NaN;
    if (!Number.isFinite(line)) continue;
    const options = market.outcomes
      .map((outcome) => {
        const prediction = predictionForOverUnder(outcome.key);
        if (prediction == null) return null;
        return txlineOption({
          prediction,
          key: outcome.key,
          label: outcome.label,
          decimalOdds: outcome.decimalOdds,
          impliedPct: outcome.impliedPct,
          multiplier: outcome.multiplier,
          txLineMessageId: market.txLineMessageId,
        });
      })
      .filter((option): option is SocialOption => option != null)
      .sort((a, b) => a.prediction - b.prediction);
    if (options.length !== 2) continue;
    out.push({
      marketType: MARKET.OVER_UNDER,
      marketKey: "over_under",
      label: `Over/Under ${line}`,
      marketParam: Math.round(line * 10),
      outcomeCount: 2,
      line,
      options,
      dataNote: "TxLINE full-time totals market mapped to program predictions: 0 under, 1 over.",
    });
  }
  return out;
}

function parseCorrectScoreOutcome(key: string): { home: number; away: number } | null {
  const match = key.match(/(\d+)\D+(\d+)/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function txlineCorrectScore(markets: OddtasyMarket[], cap: number): SocialMarket | null {
  const market = markets.find(isCorrectScore);
  if (!market) return null;
  const byPrediction = new Map<number, SocialOption>();

  for (const outcome of market.outcomes) {
    const score = parseCorrectScoreOutcome(outcome.key);
    if (!score) continue;
    const prediction = correctScorePrediction(score.home, score.away, cap);
    const existing = byPrediction.get(prediction);
    if (existing) continue;
    byPrediction.set(
      prediction,
      txlineOption({
        prediction,
        key: outcome.key,
        label: scoreLabel(Math.min(score.home, cap), Math.min(score.away, cap), cap),
        decimalOdds: outcome.decimalOdds,
        impliedPct: outcome.impliedPct,
        multiplier: outcome.multiplier,
        txLineMessageId: market.txLineMessageId,
      }),
    );
  }

  if (byPrediction.size === 0) return null;
  return {
    marketType: MARKET.CORRECT_SCORE,
    marketKey: "correct_score",
    label: "Correct Score",
    marketParam: cap,
    outcomeCount: (cap + 1) * (cap + 1),
    correctScoreCap: cap,
    options: [...byPrediction.values()].sort((a, b) => a.prediction - b.prediction),
    dataNote:
      "TxLINE correct-score prices mapped into the folded score grid. Missing buckets are left out if the feed does not price them.",
  };
}

export function modelSocialMarkets(input: ModelInput): SocialMarket[] {
  const matrix = scoreMatrix(input.homeLambda, input.awayLambda, input.rho ?? DEFAULT_RHO);
  const folded = foldMatrix(matrix, input.correctScoreCap);
  const outcomes = outcomeProbabilities(matrix);
  const totals = totalsFromMatrix(matrix);

  const matchResult: SocialMarket = {
    marketType: MARKET.MATCH_RESULT,
    marketKey: "match_result",
    label: "Match Result",
    marketParam: 0,
    outcomeCount: 3,
    options: [
      probabilityOption({ prediction: 0, key: "home", label: "Home", probability: outcomes.home }),
      probabilityOption({ prediction: 1, key: "draw", label: "Draw", probability: outcomes.draw }),
      probabilityOption({ prediction: 2, key: "away", label: "Away", probability: outcomes.away }),
    ],
    dataNote: "Model-fair odds from Dixon-Coles probabilities.",
  };

  const overUnders = DEFAULT_OU_LINES.map((line) => {
    const { over, under } = overUnder(totals, line);
    return {
      marketType: MARKET.OVER_UNDER,
      marketKey: "over_under",
      label: `Over/Under ${line}`,
      marketParam: Math.round(line * 10),
      outcomeCount: 2,
      line,
      options: [
        probabilityOption({ prediction: 0, key: "under", label: `Under ${line}`, probability: under }),
        probabilityOption({ prediction: 1, key: "over", label: `Over ${line}`, probability: over }),
      ],
      dataNote: "Model-fair odds from summed total-goals probabilities.",
    } satisfies SocialMarket;
  });

  const scoreOptions: SocialOption[] = [];
  for (let home = 0; home <= input.correctScoreCap; home++) {
    for (let away = 0; away <= input.correctScoreCap; away++) {
      const prediction = correctScorePrediction(home, away, input.correctScoreCap);
      scoreOptions.push(
        probabilityOption({
          prediction,
          key: `${home}-${away}`,
          label: scoreLabel(home, away, input.correctScoreCap),
          probability: folded[home]![away]!,
        }),
      );
    }
  }

  const correctScore: SocialMarket = {
    marketType: MARKET.CORRECT_SCORE,
    marketKey: "correct_score",
    label: "Correct Score",
    marketParam: input.correctScoreCap,
    outcomeCount: (input.correctScoreCap + 1) * (input.correctScoreCap + 1),
    correctScoreCap: input.correctScoreCap,
    options: scoreOptions,
    dataNote: "Folded exact-score grid. Last row/column is the + bucket.",
  };

  const btts = bothTeamsToScore(matrix);
  const bttsMarket: SocialMarket = {
    marketType: MARKET.BTTS,
    marketKey: "btts",
    label: "Both Teams To Score",
    marketParam: 0,
    outcomeCount: 2,
    options: [
      probabilityOption({ prediction: 0, key: "no", label: "No", probability: btts.no }),
      probabilityOption({ prediction: 1, key: "yes", label: "Yes", probability: btts.yes }),
    ],
    dataNote: "Model-fair odds: 0 no (NG), 1 yes (GG). Settles on 90-minute goals.",
  };

  const oe = oddEven(totals);
  const oddEvenMarket: SocialMarket = {
    marketType: MARKET.ODD_EVEN,
    marketKey: "odd_even",
    label: "Total Goals Odd/Even",
    marketParam: 0,
    outcomeCount: 2,
    options: [
      probabilityOption({ prediction: 0, key: "even", label: "Even", probability: oe.even }),
      probabilityOption({ prediction: 1, key: "odd", label: "Odd", probability: oe.odd }),
    ],
    dataNote: "Model-fair odds: 0 even, 1 odd. 0-0 counts as even. Settles on 90-minute goals.",
  };

  return [matchResult, ...overUnders, bttsMarket, oddEvenMarket, correctScore];
}

export function txlineSocialMarkets(markets: OddtasyMarket[], cap = config.correctScoreCap): SocialMarket[] {
  const out: SocialMarket[] = [];
  const matchResult = txlineMatchResult(markets);
  if (matchResult) out.push(matchResult);
  out.push(...txlineOverUnder(markets));
  const correctScore = txlineCorrectScore(markets, cap);
  if (correctScore) out.push(correctScore);
  return out;
}

export function blankSocialMarkets(cap = config.correctScoreCap): SocialMarket[] {
  return [
    {
      marketType: MARKET.MATCH_RESULT,
      marketKey: "match_result",
      label: "Match Result",
      marketParam: 0,
      outcomeCount: 3,
      options: [
        emptyOption(0, "home", "Home"),
        emptyOption(1, "draw", "Draw"),
        emptyOption(2, "away", "Away"),
      ],
      dataNote: "No TxLINE price or model lambda input was available.",
    },
    ...DEFAULT_OU_LINES.map(
      (line) =>
        ({
          marketType: MARKET.OVER_UNDER,
          marketKey: "over_under",
          label: `Over/Under ${line}`,
          marketParam: Math.round(line * 10),
          outcomeCount: 2,
          line,
          options: [
            emptyOption(0, "under", `Under ${line}`),
            emptyOption(1, "over", `Over ${line}`),
          ],
          dataNote: "No TxLINE price or model lambda input was available.",
        }) satisfies SocialMarket,
    ),
    {
      marketType: MARKET.BTTS,
      marketKey: "btts",
      label: "Both Teams To Score",
      marketParam: 0,
      outcomeCount: 2,
      options: [emptyOption(0, "no", "No"), emptyOption(1, "yes", "Yes")],
      dataNote: "No TxLINE price or model lambda input was available.",
    },
    {
      marketType: MARKET.ODD_EVEN,
      marketKey: "odd_even",
      label: "Total Goals Odd/Even",
      marketParam: 0,
      outcomeCount: 2,
      options: [emptyOption(0, "even", "Even"), emptyOption(1, "odd", "Odd")],
      dataNote: "No TxLINE price or model lambda input was available.",
    },
    {
      marketType: MARKET.CORRECT_SCORE,
      marketKey: "correct_score",
      label: "Correct Score",
      marketParam: cap,
      outcomeCount: (cap + 1) * (cap + 1),
      correctScoreCap: cap,
      options: Array.from({ length: cap + 1 }).flatMap((_, home) =>
        Array.from({ length: cap + 1 }).map((__, away) =>
          emptyOption(correctScorePrediction(home, away, cap), `${home}-${away}`, scoreLabel(home, away, cap)),
        ),
      ),
      dataNote: "No TxLINE price or model lambda input was available.",
    },
  ];
}

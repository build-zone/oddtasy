import type { TxLineOddsRow } from "./types.js";

const SUPER_ODDS_TYPE_LABELS: Record<string, string> = {
  "1X2": "Match Result",
  "1X2_PARTICIPANT": "Match Result",
  "1X2_PARTICIPANT_RESULT": "Match Result",
  MATCH_RESULT: "Match Result",
  OVERUNDER: "Over/Under",
  OVERUNDER_PARTICIPANT_GOALS: "Over/Under Goals",
  OVER_UNDER: "Over/Under",
  CORRECT_SCORE: "Correct Score",
  ASIAN_HANDICAP: "Asian Handicap",
  ASIANHANDICAP: "Asian Handicap",
  HANDICAP: "Handicap",
  BOTH_TEAMS_TO_SCORE: "Both Teams to Score",
  BTTS: "Both Teams to Score",
  DOUBLE_CHANCE: "Double Chance",
  DRAW_NO_BET: "Draw No Bet",
  ODD_EVEN: "Odd/Even Goals",
  ODDEVEN: "Odd/Even Goals",
};

const PERIOD_LABELS: Record<string, string> = {
  FT: "Full Time",
  H1: "1st Half",
  H2: "2nd Half",
  HT: "Half Time",
  ET: "Extra Time",
};

const OUTCOME_LABELS: Record<string, string> = {
  OVER: "Over",
  UNDER: "Under",
  YES: "Yes",
  NO: "No",
  ODD: "Odd",
  EVEN: "Even",
  HOME: "Home",
  AWAY: "Away",
  DRAW: "Draw",
  "1": "Home",
  X: "Draw",
  "2": "Away",
  PARTICIPANT1: "Home",
  PARTICIPANT2: "Away",
  PART1: "Home",
  PART2: "Away",
  P1: "Home",
  P2: "Away",
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function humanizeToken(token: string): string {
  const key = normalizeKey(token);
  if (SUPER_ODDS_TYPE_LABELS[key]) return SUPER_ODDS_TYPE_LABELS[key]!;
  if (/^\d+$/.test(token)) return token;

  return token
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const partKey = normalizeKey(part);
      if (partKey === "OVERUNDER" || partKey === "OVER_UNDER") return "Over/Under";
      if (partKey === "BTTS") return "BTTS";
      if (partKey.length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

export function formatSuperOddsType(value: string): string {
  const key = normalizeKey(value);
  if (SUPER_ODDS_TYPE_LABELS[key]) return SUPER_ODDS_TYPE_LABELS[key]!;
  return humanizeToken(value);
}

export function formatMarketPeriod(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  const key = normalizeKey(value);
  return PERIOD_LABELS[key] ?? humanizeToken(value);
}

type ParsedParameters = {
  period?: string;
  line?: string;
  handicap?: string;
  extras: string[];
};

export function parseMarketParameters(raw?: string | null): ParsedParameters {
  const result: ParsedParameters = { extras: [] };
  if (!raw?.trim()) return result;

  const tokens = raw.trim().split(/\s+/);
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) {
      result.extras.push(humanizeToken(token));
      continue;
    }

    const key = normalizeKey(token.slice(0, eq));
    const value = token.slice(eq + 1).trim();
    if (!value) continue;

    switch (key) {
      case "HALF":
        result.period = value === "1" ? "1st Half" : value === "2" ? "2nd Half" : `Half ${value}`;
        break;
      case "LINE":
        result.line = value;
        break;
      case "HANDICAP":
      case "HC":
        result.handicap = value;
        break;
      default:
        result.extras.push(`${humanizeToken(key)} ${value}`);
    }
  }

  return result;
}

function formatLineSuffix(parsed: ParsedParameters): string | undefined {
  if (parsed.handicap) return `${parsed.handicap} handicap`;
  if (parsed.line) return `Line ${parsed.line}`;
  if (parsed.extras.length > 0) return parsed.extras.join(" · ");
  return undefined;
}

export function formatMarketLabel(
  row: Pick<TxLineOddsRow, "SuperOddsType" | "MarketPeriod" | "MarketParameters">,
): string {
  const typeLabel = formatSuperOddsType(row.SuperOddsType);
  const parsed = parseMarketParameters(row.MarketParameters);
  const periodLabel =
    formatMarketPeriod(row.MarketPeriod ?? undefined) ?? parsed.period ?? undefined;
  const detail = formatLineSuffix(parsed);
  return [typeLabel, periodLabel, detail].filter(Boolean).join(" · ");
}

export function formatOutcomeLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;

  const key = normalizeKey(trimmed);
  if (OUTCOME_LABELS[key]) return OUTCOME_LABELS[key]!;
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  return humanizeToken(trimmed);
}

export function normalizedOutcomeKey(value: string): string {
  return normalizeKey(value);
}

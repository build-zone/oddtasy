import type { OddtasyMarket, OddtasyOutcome, TxLineOddsRow } from "./types.js";
import { formatMarketLabel, formatOutcomeLabel } from "./format-market.js";

const HOUSE_EDGE = 0.02;

function marketKey(row: TxLineOddsRow): string {
  return `${row.SuperOddsType}|${row.MarketPeriod ?? "null"}|${row.MarketParameters ?? "null"}`;
}

function toDecimalOdds(rawPrice: number): number {
  if (rawPrice <= 0) return 0;
  return rawPrice / 1000;
}

function toOutcome(name: string, rawPrice: number, pct: number | string | undefined): OddtasyOutcome {
  const decimalOdds = toDecimalOdds(rawPrice);
  const parsedPct =
    typeof pct === "number" ? pct : typeof pct === "string" ? parseFloat(pct) : Number.NaN;
  // TxLINE StablePrice Pct is usually a 0–100 percentage string (e.g. "23.315").
  const impliedFromPct =
    Number.isFinite(parsedPct) && parsedPct > 0 ? (parsedPct > 1 ? parsedPct / 100 : parsedPct) : 0;
  const impliedPct = impliedFromPct > 0 ? impliedFromPct : decimalOdds > 0 ? 1 / decimalOdds : 0;
  const multiplier =
    impliedPct > 0 ? (1 / impliedPct) * (1 - HOUSE_EDGE) : decimalOdds * (1 - HOUSE_EDGE);

  return {
    key: name,
    label: formatOutcomeLabel(name),
    rawPrice,
    decimalOdds,
    multiplier: Number(multiplier.toFixed(2)),
    impliedPct,
  };
}

export function normalizeMarkets(rows: TxLineOddsRow[]): OddtasyMarket[] {
  const byKey = new Map<string, TxLineOddsRow>();

  for (const row of rows) {
    const key = marketKey(row);
    const existing = byKey.get(key);
    if (!existing || row.Ts >= existing.Ts) {
      byKey.set(key, row);
    }
  }

  return Array.from(byKey.values()).map((row) => ({
    id: marketKey(row),
    fixtureId: row.FixtureId,
    label: formatMarketLabel(row),
    superOddsType: row.SuperOddsType,
    marketPeriod: row.MarketPeriod,
    marketParameters: row.MarketParameters,
    inRunning: row.InRunning,
    txLineMessageId: row.MessageId,
    outcomes: row.PriceNames.map((name, i) => toOutcome(name, row.Prices[i] ?? 0, row.Pct?.[i])),
  }));
}

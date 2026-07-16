"use client";

import { useState } from "react";
import type { SocialMarket, SocialOption } from "@/lib/types";
import { odds, pct } from "@/lib/format";

export type MarketSelection = {
  market: SocialMarket;
  option: SocialOption;
};

const MAIN_LINE = 2.5;

function lineOf(m: SocialMarket): number {
  return m.line ?? m.marketParam;
}

/** True when this selection lives on this market (either side of the line). */
function isSelectedMarket(sel: MarketSelection | null, market: SocialMarket): boolean {
  return (
    sel != null &&
    sel.market.marketKey === market.marketKey &&
    sel.market.marketParam === market.marketParam
  );
}

function isSel(sel: MarketSelection | null, market: SocialMarket, option: SocialOption) {
  return (
    sel != null &&
    sel.market.marketKey === market.marketKey &&
    sel.market.marketParam === market.marketParam &&
    sel.option.prediction === option.prediction
  );
}

function prob(o: SocialOption): number | undefined {
  if (o.probability != null) return o.probability;
  if (o.impliedPct != null) return o.impliedPct / 100;
  if (o.decimalOdds != null && o.decimalOdds > 0) return 1 / o.decimalOdds;
  return undefined;
}

/**
 * Sequential ramp for scoreline probability: one hue (brand amber), surface →
 * full chroma as the score gets likelier.
 *
 * This was a green→yellow→orange→red rainbow at full saturation on all 25
 * cells. Two problems: a rainbow encodes *magnitude* with hue, which reads as
 * categories rather than a scale; and green/red additionally reads as
 * good/bad, so the 132.0 longshot glowed red like a warning instead of
 * receding as the improbable score it is. Twenty-five saturated blocks also
 * left the eye no anchor.
 *
 * One hue fixes all three: unlikely scorelines sink toward the surface,
 * likely ones glow, and "hot" means probable rather than dangerous.
 */
/**
 * The ramp stays deliberately muted. A brighter top end forced the ink to flip
 * from light to dark partway up, and the crossover created a band (t≈0.52–0.62)
 * where *neither* ink cleared 4.5:1 — unreadable cells at any flip point, since
 * a dark→bright ramp must cross that valley. Capping at rgb(110,86,40) keeps one
 * light ink safe across the whole scale (5.05:1 at the brightest step), and big
 * blocks are supposed to be recessive anyway — the per-cell % carries the value.
 */
const HEAT_STOPS: [number, [number, number, number]][] = [
  [0, [24, 40, 32]], // ~surface: a longshot should barely register
  [0.5, [62, 58, 36]],
  [0.8, [90, 74, 38]],
  [1, [110, 86, 40]],
];

function heatT(p: number | undefined, pmax: number): number {
  if (p == null || pmax <= 0) return 0;
  // sqrt: scoreline probabilities cluster low, so a linear ramp would leave
  // almost every cell at the dark end and encode nothing
  return Math.sqrt(Math.min(1, p / pmax));
}

function heatColor(p: number | undefined, pmax: number): string {
  if (p == null || pmax <= 0) return "var(--surface2)";
  const t = heatT(p, pmax);
  let a = HEAT_STOPS[0];
  let b = HEAT_STOPS[HEAT_STOPS.length - 1];
  for (let k = 0; k < HEAT_STOPS.length - 1; k++) {
    if (t >= HEAT_STOPS[k][0] && t <= HEAT_STOPS[k + 1][0]) {
      a = HEAT_STOPS[k];
      b = HEAT_STOPS[k + 1];
      break;
    }
  }
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  const c = [0, 1, 2].map((n) => Math.round(a[1][n] + (b[1][n] - a[1][n]) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}


/**
 * Where the prices on screen actually come from, summarised across every
 * outcome in every market. Fans can't otherwise tell a live market book from
 * the model's fair estimate — they render in identical type — so we say it
 * once, plainly, at the top. Data-driven: the moment TxLINE carries a book,
 * `priceSource` flips to "txline" and this badge follows without a code change.
 */
type SourceSummary = "txline" | "model" | "mixed" | "none";

function summarizeSource(markets: SocialMarket[]): SourceSummary {
  let txline = 0;
  let model = 0;
  for (const m of markets) {
    for (const o of m.options) {
      if (o.priceSource === "txline") txline++;
      else if (o.priceSource === "model_fair") model++;
    }
  }
  if (txline === 0 && model === 0) return "none";
  if (txline > 0 && model > 0) return "mixed";
  if (txline > 0) return "txline";
  return "model";
}

function MarketSourceBadge({ markets }: { markets: SocialMarket[] }) {
  const source = summarizeSource(markets);
  if (source === "none") return null;

  // model / mixed lean amber (a heads-up), a fully-live book is green (--good).
  const isLive = source === "txline";
  const label =
    source === "txline"
      ? "Live TxLINE market prices"
      : source === "mixed"
        ? "Part live market, part model estimate"
        : "Model prices — no live market book on this match yet";

  return (
    <div className="flex justify-center">
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] px-2.5 py-1 rounded-full border ${
          isLive ? "text-good border-line2" : "text-home border-line2"
        }`}
      >
        <i
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: isLive ? "var(--good)" : "var(--home)" }}
          aria-hidden
        />
        {label}
      </span>
    </div>
  );
}

/* ---- match result (1X2): the flat WDL bar ---- */
function MatchResultPicker({
  market,
  homeName,
  awayName,
  selection,
  onSelect,
}: {
  market: SocialMarket;
  homeName: string;
  awayName: string;
  selection: MarketSelection | null;
  onSelect: (sel: MarketSelection) => void;
}) {
  const segs: { cls: "home" | "draw" | "away"; label: string; prediction: number }[] = [
    { cls: "home", label: `${homeName} win`, prediction: 0 },
    { cls: "draw", label: "Draw", prediction: 1 },
    { cls: "away", label: `${awayName} win`, prediction: 2 },
  ];
  const color = { home: "var(--home)", draw: "var(--ink)", away: "var(--away)" };
  return (
    <div className="wdl">
      {segs.map((seg) => {
        const option = market.options.find((o) => o.prediction === seg.prediction);
        if (!option) return null;
        const p = prob(option);
        const sel = isSel(selection, market, option);
        return (
          <button
            key={seg.prediction}
            type="button"
            className={`wdl-seg ${seg.cls} ${sel ? "sel" : ""}`}
            onClick={() => onSelect({ market, option })}
            aria-pressed={sel}
            aria-label={`${seg.label} — ${pct(p)}, odds ${odds(option.decimalOdds)}`}
          >
            <span className="wdl-top">
              <span className="wdl-lbl">{seg.label}</span>
              <span className="wdl-pc">
                {pct(p)}
                <small>{odds(option.decimalOdds)}</small>
              </span>
            </span>
            <span className="wdl-track">
              <i
                style={{
                  width: pct(p),
                  background: color[seg.cls],
                }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- over/under: split bars per line. Server encodes under=0, over=1. ---- */
function OverUnderPicker({
  market,
  selection,
  onSelect,
}: {
  market: SocialMarket;
  selection: MarketSelection | null;
  onSelect: (sel: MarketSelection) => void;
}) {
  const under = market.options.find((o) => o.prediction === 0);
  const over = market.options.find((o) => o.prediction === 1);
  const overP = over ? prob(over) : undefined;
  const line = lineOf(market);
  const isMain = line === MAIN_LINE;
  return (
    <div className="oubar">
      <div className="ou-top">
        {/* the main line is marked with a dot, not two words — it wrapped the
            row and it is a hint, not a label */}
        <span className="ou-side ou-o" title={isMain ? "Main line" : undefined}>
          O {line}
          {isMain && <i className="ou-main" aria-label="main line" />}{" "}
          <b>{pct(overP)}</b>
          <small>{odds(over?.decimalOdds)}</small>
        </span>
        <span className="ou-side ou-u">
          <b>{pct(under ? prob(under) : undefined)}</b>
          <small>{odds(under?.decimalOdds)}</small> U {line}
        </span>
        {over && (
          <button
            type="button"
            className={`ou-pick ${isSel(selection, market, over) ? "sel" : ""}`}
            onClick={() => onSelect({ market, option: over })}
          >
            Over
          </button>
        )}
        {under && (
          <button
            type="button"
            className={`ou-pick ${isSel(selection, market, under) ? "sel" : ""}`}
            onClick={() => onSelect({ market, option: under })}
          >
            Under
          </button>
        )}
      </div>
      <div className="ou-track">
        <i style={{ width: overP != null ? `${(overP * 100).toFixed(1)}%` : "0%" }} />
      </div>
    </div>
  );
}

/**
 * Total goals — the main line, and the rest on request.
 *
 * The feed returns every line from 0.5 up, and showing them all gave four
 * near-identical rows of eight numbers each: a spreadsheet, in the middle of a
 * fan product. Almost nobody is betting Over 0.5 at 1.12. So 2.5 leads, and
 * the other lines stay one tap away.
 *
 * A line you have already picked always renders, even collapsed — hiding
 * someone's own bet to save space would be a worse trade than the noise.
 */
function TotalGoals({
  markets,
  selection,
  onSelect,
}: {
  markets: SocialMarket[];
  selection: MarketSelection | null;
  onSelect: (sel: MarketSelection) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  // Prefer 2.5; if the feed doesn't price it, fall back to the closest line so
  // there is always a headline rather than an empty section.
  const main =
    markets.find((m) => lineOf(m) === MAIN_LINE) ??
    [...markets].sort(
      (a, b) => Math.abs(lineOf(a) - MAIN_LINE) - Math.abs(lineOf(b) - MAIN_LINE),
    )[0];

  const visible = showAll
    ? markets
    : markets.filter((m) => m === main || isSelectedMarket(selection, m));
  const hiddenCount = markets.length - visible.length;

  return (
    <section>
      <p className="k mb-2.5">Total goals</p>
      <div className="flex flex-col gap-3.5">
        {visible.map((m) => (
          <OverUnderPicker
            key={m.marketParam}
            market={m}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </div>

      {(hiddenCount > 0 || showAll) && (
        <button type="button" className="ou-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Fewer lines" : `${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`}
        </button>
      )}
    </section>
  );
}

/* ---- correct score: the heat matrix. prediction = home*(cap+1)+away ---- */
function CorrectScorePicker({
  market,
  selection,
  onSelect,
}: {
  market: SocialMarket;
  selection: MarketSelection | null;
  onSelect: (sel: MarketSelection) => void;
}) {
  const cap = market.correctScoreCap ?? market.marketParam;
  const width = cap + 1;
  const byPrediction = new Map(market.options.map((o) => [o.prediction, o]));
  const pmax = Math.max(
    ...market.options.map((o) => prob(o) ?? 0),
    0,
  );
  const gl = (n: number) => (n >= cap ? `${cap}+` : String(n));

  const cells = [];
  for (let idx = 0; idx < width * width; idx++) {
    const i = Math.floor(idx / width);
    const j = idx % width;
    const option = byPrediction.get(idx);
    const p = option ? prob(option) : undefined;
    const sel = option ? isSel(selection, market, option) : false;
    const priced = option && option.priceSource !== "unpriced" && p != null;
    cells.push(
      <button
        key={idx}
        type="button"
        className={`mcell ${sel ? "sel" : ""} ${priced ? "" : "unpriced"}`}
        style={priced ? { background: heatColor(p, pmax) } : undefined}
        disabled={!option}
        onClick={() => option && onSelect({ market, option })}
        aria-label={
          option
            ? `${gl(i)}–${gl(j)} — ${pct(p)}, odds ${odds(option.decimalOdds)}`
            : `${gl(i)}–${gl(j)} — not priced`
        }
      >
        {/* Score over percentage. Decimal odds are gone from the face: they were
            the value that clipped, they're the jargon of the two, and the sheet
            quotes them the moment you pick. The aria-label still carries them. */}
        <span className="cz-c">
          {gl(i)}–{gl(j)}
        </span>
        {p != null && <span className="cz-p">{pct(p)}</span>}
      </button>,
    );
  }

  return (
    <div className="matrix" style={{ "--cols": width } as React.CSSProperties}>
      {cells}
    </div>
  );
}

/* ---- composed picker: one section per market ---- */
export function MarketPicker({
  markets,
  homeName,
  awayName,
  selection,
  onSelect,
}: {
  markets: SocialMarket[];
  homeName: string;
  awayName: string;
  selection: MarketSelection | null;
  onSelect: (sel: MarketSelection) => void;
}) {
  const matchResult = markets.find((m) => m.marketKey === "match_result");
  const overUnders = markets.filter((m) => m.marketKey === "over_under");
  const correctScore = markets.find((m) => m.marketKey === "correct_score");

  return (
    <div className="flex flex-col gap-7">
      <MarketSourceBadge markets={markets} />
      {matchResult && (
        <section>
          <p className="k mb-2.5">Match result</p>
          <MatchResultPicker
            market={matchResult}
            homeName={homeName}
            awayName={awayName}
            selection={selection}
            onSelect={onSelect}
          />
        </section>
      )}

      {overUnders.length > 0 && (
        <TotalGoals markets={overUnders} selection={selection} onSelect={onSelect} />
      )}

      {correctScore && (
        <section>
          <p className="k mb-2.5">Correct score</p>
          {/* No dataNote caption here: it is API metadata for whoever reads the
              endpoint (every value is engineering prose — "mapped to program
              predictions: 0 home, 1 draw, 2 away"), this was the one place it
              leaked onto the UI, and it named a different product while doing
              it. The "4+" cells already say what the last row and column are. */}
          <CorrectScorePicker
            market={correctScore}
            selection={selection}
            onSelect={onSelect}
          />
        </section>
      )}
    </div>
  );
}

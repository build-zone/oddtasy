"use client";

import type { SocialMarket, SocialOption } from "@/lib/types";
import { odds, pct } from "@/lib/format";

export type MarketSelection = {
  market: SocialMarket;
  option: SocialOption;
};

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

/* Ranktasy heat spectrum: green = most likely → red = least likely. */
function heatColor(p: number | undefined, pmax: number): string {
  if (p == null || pmax <= 0) return "var(--surface2)";
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
  const line = market.line ?? market.marketParam;
  const isMain = line === 2.5;
  return (
    <div className="oubar">
      <div className="ou-top">
        <span className="ou-side ou-o">
          O {line}
          {isMain && <span className="k ml-1 text-faint normal-case">main line</span>}{" "}
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
        <span className="cz cz-tl">{p != null ? pct(p) : ""}</span>
        <span className="cz cz-tr">{option ? odds(option.decimalOdds) : ""}</span>
        <span className="cz cz-c">
          {gl(i)}–{gl(j)}
        </span>
        <span className="cz cz-br" />
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
        <section>
          <p className="k mb-2.5">Total goals</p>
          <div className="flex flex-col gap-3.5">
            {overUnders.map((m) => (
              <OverUnderPicker
                key={m.marketParam}
                market={m}
                selection={selection}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}

      {correctScore && (
        <section>
          <p className="k mb-2.5">Correct score</p>
          <CorrectScorePicker
            market={correctScore}
            selection={selection}
            onSelect={onSelect}
          />
          <p className="font-mono text-[10.5px] text-faint text-center mt-3 leading-relaxed">
            {correctScore.dataNote}
          </p>
        </section>
      )}
    </div>
  );
}

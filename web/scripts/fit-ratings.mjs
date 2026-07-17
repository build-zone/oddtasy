/**
 * fit-ratings.mjs — regenerate web/src/lib/priors.ts team ratings from real
 * international results. Ratings are NOT hand-set; they are fitted here.
 *
 * Usage (from web/):
 *   curl -sSL https://raw.githubusercontent.com/martj42/international_results/master/results.csv \
 *     -o scripts/results.csv
 *   node scripts/fit-ratings.mjs
 *
 * Method: opponent-adjusted Poisson attack/defence over a 4-year window
 * (2021-07 → now), 2-year recency half-life, small-sample shrinkage, rescaled
 * multiplicatively onto the model's operating mean (team-vs-team ratios
 * preserved). Prints a before/after table and a paste-ready TEAM_LAMBDA block.
 * The CURRENT map below is only the previous table, kept for the before/after
 * diff. Dataset: martj42/international_results (open, CC0-ish, continuously updated).
 */
import { readFileSync } from "node:fs";

// ---- previous table (kept only to print the before/after diff) ----
const CURRENT = {
  brazil:2.25, france:2.2, spain:2.15, argentina:2.1, england:2.1, germany:2.0,
  portugal:1.95, netherlands:1.95, belgium:1.8, italy:1.7, colombia:1.65, usa:1.65,
  uruguay:1.6, switzerland:1.6, croatia:1.5, denmark:1.5, morocco:1.5, mexico:1.45,
  senegal:1.4, ukraine:1.4, "czech republic":1.4, "ivory coast":1.4, algeria:1.35,
  nigeria:1.35, turkey:1.35, "south korea":1.3, norway:1.3, poland:1.3, japan:1.25,
  sweden:1.25, austria:1.25, canada:1.25, chile:1.2, cameroon:1.2, egypt:1.2, serbia:1.2,
  ecuador:1.15, australia:1.15, "south africa":1.15, ghana:1.15, peru:1.1, scotland:1.1,
  paraguay:1.05, wales:1.05, iran:1.05, tunisia:1.05, venezuela:1.0, "costa rica":0.95,
  jamaica:0.95, "saudi arabia":0.9, panama:0.9, "new zealand":0.9, bosnia:0.9,
  "congo dr":0.9, iraq:0.9, qatar:0.85, honduras:0.8, bolivia:0.8, jordan:0.75,
  haiti:0.75, "cape verde":0.7, uzbekistan:0.7, curacao:0.7, vietnam:0.65, india:0.55, myanmar:0.5,
};

// dataset name -> model key
const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const ALIAS = {
  "united states":"usa", "czechia":"czech republic", "türkiye":"turkey",
  "dr congo":"congo dr", "cote d'ivoire":"ivory coast", "côte d'ivoire":"ivory coast",
  "bosnia and herzegovina":"bosnia", "china pr":"china", "republic of ireland":"ireland",
};
const key = (name) => { const k = stripAccents(name).toLowerCase().trim(); return ALIAS[k] ?? k; };

// ---- parse ----
const lines = readFileSync(new URL("./results.csv", import.meta.url), "utf8").split("\n");
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const L = lines[i]; if (!L) continue;
  const c = L.split(","); // this dataset has no embedded commas in the fields we use
  const [date, home, away, hs, as] = c;
  if (hs === "NA" || as === "NA" || hs === undefined) continue;
  const neutral = (c[8] ?? "").trim().toUpperCase() === "TRUE";
  rows.push({ date, home: key(home), away: key(away), hs: +hs, as: +as, neutral });
}

// ---- window + recency weight ----
const NOW = new Date("2026-07-17");
const START = new Date("2021-07-01");
const HALF_LIFE_Y = 2.0;
const sample = rows.filter((r) => new Date(r.date) >= START);
const yearsAgo = (d) => (NOW - new Date(d)) / (365.25 * 864e5);
for (const r of sample) r.w = Math.pow(0.5, yearsAgo(r.date) / HALF_LIFE_Y);

// ---- weighted Poisson attack/def/home fit (multiplicative iteration) ----
const teams = [...new Set(sample.flatMap((r) => [r.home, r.away]))];
let totGoals = 0, totW = 0;
for (const r of sample) { totGoals += (r.hs + r.as) * r.w; totW += r.w; }
const mu = totGoals / (2 * totW); // weighted avg goals per team per game
const atk = Object.fromEntries(teams.map((t) => [t, 1]));
const def = Object.fromEntries(teams.map((t) => [t, 1]));
let home = 1.25;

for (let iter = 0; iter < 30; iter++) {
  const aN = {}, aD = {}, dN = {}, dD = {};
  for (const t of teams) { aN[t]=aD[t]=dN[t]=dD[t]=0; }
  let hN = 0, hD = 0;
  for (const r of sample) {
    const hAdv = r.neutral ? 1 : home;
    // attacker numerators = weighted goals scored; denominators = expected-per-unit-atk
    aN[r.home] += r.w * r.hs;  aD[r.home] += r.w * mu * def[r.away] * hAdv;
    aN[r.away] += r.w * r.as;  aD[r.away] += r.w * mu * def[r.home];
    dN[r.away] += r.w * r.hs;  dD[r.away] += r.w * mu * atk[r.home] * hAdv;
    dN[r.home] += r.w * r.as;  dD[r.home] += r.w * mu * atk[r.away];
    if (!r.neutral) { hN += r.w * r.hs; hD += r.w * mu * atk[r.home] * def[r.away]; }
  }
  for (const t of teams) {
    if (aD[t] > 0) atk[t] = aN[t] / aD[t];
    if (dD[t] > 0) def[t] = dN[t] / dD[t];
  }
  // Remove the atk/def scale degeneracy: anchor each to mean 1 every iteration,
  // otherwise the multiplicative solve drifts (attack*c, defense/c is the same fit).
  const amean = teams.reduce((s, t) => s + atk[t], 0) / teams.length;
  const dmean = teams.reduce((s, t) => s + def[t], 0) / teams.length;
  for (const t of teams) { atk[t] /= amean; def[t] /= dmean; }
  if (hD > 0) home = Math.min(1.6, Math.max(1.0, hN / hD));
}

// weighted game count per team (for shrinkage + confidence)
const games = Object.fromEntries(teams.map((t) => [t, 0]));
const rawN = Object.fromEntries(teams.map((t) => [t, 0]));
for (const r of sample) { games[r.home]+=r.w; games[r.away]+=r.w; rawN[r.home]++; rawN[r.away]++; }

// rating = expected goals vs an AVERAGE opponent (def=1), neutral ground.
// shrink attack toward league-average (1.0) with K pseudo-games for small samples.
const K = 6;
const rawRating = {};
for (const t of teams) {
  const shrunkAtk = (atk[t] * games[t] + 1 * K) / (games[t] + K);
  rawRating[t] = mu * shrunkAtk;
}
// Multiplicative rescale onto the model's operating scale (ratio-preserving, so
// every team-vs-team ratio is exactly what the data says). Anchor the mean of
// the rated WC field to TARGET so downstream damping/clamp stay calibrated.
const TARGET_MEAN = 1.30;
const ratedKeys = Object.keys(CURRENT).filter((k) => rawRating[k] != null);
const fieldMean = ratedKeys.reduce((s, k) => s + rawRating[k], 0) / ratedKeys.length;
const scale = TARGET_MEAN / fieldMean;
const rating = {};
for (const t of teams) rating[t] = rawRating[t] * scale;

// ---- before/after over the CURRENT model keys ----
const round2 = (x) => Math.round(x * 100) / 100;
const out = [];
for (const k of Object.keys(CURRENT)) {
  const r = rating[k];
  out.push({ team: k, before: CURRENT[k], after: r != null ? round2(r) : null, games: rawN[k] ?? 0 });
}
out.sort((a, b) => (b.after ?? -1) - (a.after ?? -1));

const vals = out.filter((o) => o.after != null).map((o) => o.after);
// rank movement: old rank vs new rank across the rated teams
const rankBefore = [...out].filter(o=>o.after!=null).sort((a,b)=>b.before-a.before).map(o=>o.team);
const rankAfter  = [...out].filter(o=>o.after!=null).sort((a,b)=>b.after-a.after).map(o=>o.team);
const oldRank = Object.fromEntries(rankBefore.map((t,i)=>[t,i+1]));
const newRank = Object.fromEntries(rankAfter.map((t,i)=>[t,i+1]));

console.log(`window ${START.toISOString().slice(0,10)}→now | ${sample.length} matches | mu=${round2(mu)} goals/team/game | home_adv=${round2(home)}`);
console.log(`rescaled range: ${round2(Math.min(...vals))}–${round2(Math.max(...vals))} | field mean=${round2(vals.reduce((a,b)=>a+b,0)/vals.length)} (target 1.30)\n`);
console.log("team".padEnd(17), "before  after   Δ    rank(old→new)   n");
for (const o of out) {
  if (o.after == null) { console.log(o.team.padEnd(17), String(o.before).padStart(6), "    —   (no data / name mismatch)"); continue; }
  const d = round2(o.after - o.before);
  const rm = oldRank[o.team] - newRank[o.team]; // + = moved up
  const rankStr = `${String(oldRank[o.team]).padStart(2)}→${String(newRank[o.team]).padStart(2)}`;
  const move = rm>=8?"  ⇈ big riser":rm<=-8?"  ⇊ big faller":rm>=3?"  ↑":rm<=-3?"  ↓":"";
  console.log(o.team.padEnd(17), String(o.before).padStart(6), String(o.after).padStart(6), (d>=0?"+":"")+d.toFixed(2).padStart(5), " ", rankStr, String(o.games).padStart(4), move);
}

// ---- emit the new TEAM_LAMBDA block, preserving the file's exact keys+aliases ----
const CANON = { "united states":"usa", "türkiye":"turkey", "bosnia and herzegovina":"bosnia", "bosnia & herzegovina":"bosnia" };
const resolve = (origKey) => rating[CANON[origKey] ?? origKey];
// original file key order (with aliases inline where they sit)
const ORDER = [
  ["brazil"],["france"],["spain"],["argentina"],["england"],["germany"],["portugal"],["netherlands"],["belgium"],["italy"],
  ["colombia"],["usa"],["united states"],["uruguay"],["switzerland"],["croatia"],["denmark"],["morocco"],["mexico"],["senegal"],
  ["ukraine"],["czech republic"],["ivory coast"],["algeria"],["nigeria"],["turkey"],["türkiye"],["south korea"],["norway"],["poland"],
  ["japan"],["sweden"],["austria"],["canada"],["chile"],["cameroon"],["egypt"],["serbia"],["ecuador"],["australia"],["south africa"],
  ["ghana"],["peru"],["scotland"],["paraguay"],["wales"],["iran"],["tunisia"],["venezuela"],["costa rica"],["jamaica"],["saudi arabia"],
  ["panama"],["new zealand"],["bosnia"],["bosnia and herzegovina"],["bosnia & herzegovina"],["congo dr"],["iraq"],["qatar"],["honduras"],
  ["bolivia"],["jordan"],["haiti"],["cape verde"],["uzbekistan"],["curacao"],["vietnam"],["india"],["myanmar"],
];
const needsQuote = (k) => /[^a-z]/.test(k);
console.log("\n\n// ===== GENERATED TEAM_LAMBDA (paste-ready) =====");
for (const [k] of ORDER) {
  const v = resolve(k);
  if (v == null) { console.log(`  // MISSING: ${k}`); continue; }
  const kk = needsQuote(k) ? `"${k}"` : k;
  console.log(`  ${kk}: ${round2(v)},`);
}
console.log(`\n// DEFAULT_LAMBDA = ${round2(vals.reduce((a,b)=>a+b,0)/vals.length)}  (field mean)`);

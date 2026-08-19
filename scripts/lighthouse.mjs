#!/usr/bin/env node
/**
 * Lighthouse, committed and runnable — with medians, because one run is noise.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Ten UI revisions were steered by Lighthouse numbers produced by
 * uncommitted scratchpad scripts. Nothing a fresh clone could run would
 * reproduce them, which is the reason for this file.
 *
 * ── AND WHAT r16 GOT WRONG ABOUT THEM ─────────────────────────────────
 *
 * r16 reported that those numbers were "not true". That was wrong, and
 * the correction matters more than the original claim did.
 *
 * The old figures were labelled, and r16 did not read the label. CHANGELOG
 * r4 records "Lighthouse DESKTOP: performance 100 on every route" and, in
 * the very next line, "Lighthouse MOBILE (Moto G Power, 4x CPU, slow 4G):
 * performance 75 / 87 / 76 / 74 … short of the brief's 90". The mobile
 * shortfall was measured and written down at the time. r16 compared this
 * runner's MOBILE medians against the DESKTOP figure and announced a gap
 * that was a unit error.
 *
 * Re-measured on a quiet machine in r17, all three configurations:
 *
 *                mobile   desktop   desktop
 *                          preset   unthrottled
 *   /              78        80        100
 *   /trades        88        89         99
 *   /screener      62        60         78
 *
 * The historical "desktop 100" reproduces exactly — unthrottled. The
 * historical mobile figures reproduce too: 78/88/74 today against r4's
 * 75/87/74 on `/`, `/trades`, `/stock`. Nothing regressed on those.
 *
 * `/screener` is the exception and the one real finding: r4 measured it at
 * 76 mobile, it medians 62 now, and even unthrottled it reaches only 78
 * where its neighbours reach 99-100. See docs/performance.md.
 *
 * The second lesson is r16's other mistake: its numbers were taken while
 * builds, a dev server and two browsers were running. `/screener` medians
 * 61 loaded and 62 quiet, but `/` moved 78 -> 78 and `/trades` 90 -> 88,
 * and the per-run spread on `/screener` is 57-76. The changelog warned
 * about this in r4 — "the test is measuring the machine" — after twenty-one
 * orphaned Chrome processes skewed a sweep.
 *
 * ── WHY MEDIANS ───────────────────────────────────────────────────────
 *
 * Lighthouse performance is a sampled measurement of a machine under load,
 * not a property of the page. `/` oscillates between 99 and 100 run to
 * run on the same build. A gate that fails on a single 99 teaches people
 * to re-run it until it is green, which is worse than no gate: it trains
 * the habit of dismissing a red. So each route is sampled `--runs` times
 * (default 3) and judged on the MEDIAN, with every sample printed so the
 * spread is visible rather than hidden behind the summary.
 *
 * ── TWO THRESHOLDS, DELIBERATELY ──────────────────────────────────────
 *
 * See TARGETS below. `goal` is what this project claims; `floor` is what
 * it measures. They are far apart, the gate fails on the floor and prints
 * the gap to the goal on every run, and neither number is edited to make
 * the other comfortable.
 *
 * Usage:
 *   pnpm lighthouse                     # mobile preset, localhost:3100
 *   pnpm lighthouse --runs=5
 *   pnpm lighthouse --preset=desktop
 *   pnpm lighthouse --base=http://localhost:3000
 *
 * Needs a server already running — deliberately, so the score belongs to a
 * production build somebody chose, not to whatever this script built.
 */
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg("base", "http://localhost:3100").replace(/\/$/, "");
const RUNS = Number(arg("runs", "3"));
/** "mobile" (Lighthouse default, 4x CPU throttle) or "desktop". */
const PRESET = arg("preset", "mobile");

/**
 * TWO NUMBERS PER ROUTE.
 *
 * `goal` is the mobile bar the original brief set: 90, which r4 measured
 * as unmet and said so. It is kept at 90 rather than the 95 r16 invented,
 * because 90 is the number this project actually committed to on this
 * preset.
 *
 * `floor` is the median of 5 quiet runs on 2026-08-19, minus a margin for
 * the run-to-run spread each route actually shows. The gate fails below
 * the floor and prints the gap to the goal on every run.
 *
 *              two sweeps of 5 (spread)   goal   r4 mobile
 *   /             79, 81  (71-81)          90        75
 *   /trades       86, 87  (83-90)          90        87
 *   /screener     84, 82  (80-85)          90        76   <- was 62 in r17
 *   /stock/ZZ..   73, 71  (69-73)          90        74
 *   /design       70, 67  (63-73)          85         —    (10k-row page)
 *
 * `/screener` was the r17 finding and is the r18 fix. It measured 62 with a
 * 19-point spread; the spread was layout shift landing after first paint on
 * some loads and before it on others, and CLS is 25% of the mobile score.
 * With the shift gone it medians 84 across a 2-point spread. Only its floor
 * moved — the other four are untouched, because this round did not measure
 * an improvement on them and a floor raised on noise is a false red waiting
 * to happen. See docs/performance.md.
 *
 * `/stock/ZZNOVA` uses a synthetic fixture on purpose: a real ticker would
 * make the gate depend on which company happened to be seeded.
 */
const TARGETS = [
  {
    route: "/",
    goal: { performance: 90, accessibility: 100 },
    floor: { performance: 72, accessibility: 100 },
  },
  {
    route: "/trades",
    goal: { performance: 90, accessibility: 100 },
    floor: { performance: 82, accessibility: 100 },
  },
  {
    route: "/screener",
    // Floor raised 55 -> 78 in r18. The 55 existed because the route was
    // bimodal — 57 to 76 on an unchanging build — and a floor inside a
    // route's own noise band is a gate people learn to re-run. r18 found
    // the bimodality was layout shift (CLS 0.41-0.49 on the loads that
    // shifted, 0.001 on the ones that did not) and removed it, so the
    // spread is now 83-85 and the floor can sit where a real regression
    // trips it. Going back to 62 must fail, and at 55 it did not.
    goal: { performance: 90, accessibility: 100 },
    floor: { performance: 78, accessibility: 100 },
  },
  {
    route: "/stock/ZZNOVA",
    goal: { performance: 90, accessibility: 100 },
    floor: { performance: 65, accessibility: 100 },
  },
  // Every primitive plus a 10k-row virtualised table, by design.
  {
    route: "/design",
    goal: { performance: 85, accessibility: 100 },
    floor: { performance: 66, accessibility: 100 },
  },
];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const chrome = await launch({
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});

const results = [];
try {
  for (const target of TARGETS) {
    const url = `${BASE}${target.route}`;
    const samples = { performance: [], accessibility: [] };

    for (let run = 0; run < RUNS; run += 1) {
      const { lhr } = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        // NAMED, because the preset is most of the number. Lighthouse's
        // default is mobile with 4x CPU throttling and a slow-4G network;
        // desktop scores 20-30 points higher on the same build for the
        // same page. A performance figure quoted without its preset says
        // almost nothing, and the uncommitted "median 100" this file
        // replaces did not carry one.
        ...(PRESET === "desktop" ? { preset: "desktop" } : {}),
      });
      for (const category of ["performance", "accessibility"]) {
        samples[category].push(Math.round((lhr.categories[category]?.score ?? 0) * 100));
      }
    }

    const row = {
      route: target.route,
      performance: median(samples.performance),
      accessibility: median(samples.accessibility),
      samples,
      target,
    };
    results.push(row);

    console.log(
      `${target.route.padEnd(16)} perf ${String(row.performance).padStart(3)} ` +
        `[${samples.performance.join(" ")}]  a11y ${String(row.accessibility).padStart(3)} ` +
        `[${samples.accessibility.join(" ")}]`,
    );
  }
} finally {
  // try/catch, not `.catch()`: chrome-launcher's `kill()` deletes the temp
  // profile SYNCHRONOUSLY, so on Windows — where Chrome still holds handles
  // in that directory for a moment — it THROWS rather than rejecting, and a
  // promise catch never sees it. Measured: the first version used
  // `.catch()` and the run still died with EPERM after printing every
  // score, reporting a crash where it had an answer.
  try {
    await chrome.kill();
  } catch {
    /* teardown only; the measurement above is already complete */
  }
}

const CATEGORIES = ["performance", "accessibility"];

const regressions = results.flatMap((r) =>
  CATEGORIES.filter((c) => r[c] < r.target.floor[c]).map(
    (c) =>
      `${r.route} ${c}: median ${r[c]} < floor ${r.target.floor[c]} (samples ${r.samples[c].join(", ")})`,
  ),
);

const shortfalls = results.flatMap((r) =>
  CATEGORIES.filter((c) => r[c] < r.target.goal[c]).map(
    (c) =>
      `${r.route.padEnd(16)} ${c.padEnd(14)} ${String(r[c]).padStart(3)} / ${r.target.goal[c]}`,
  ),
);

console.log("");
if (shortfalls.length > 0) {
  // Printed every run, pass or fail. The deficit between what this project
  // claims and what it measures is the thing most worth not forgetting,
  // and a gate that goes green without mentioning it is how it gets
  // forgotten.
  console.log(`STANDING DEFICIT — ${shortfalls.length} below the stated goal:`);
  for (const s of shortfalls) console.log(`  ${s}`);
  console.log("");
}

if (regressions.length > 0) {
  console.error("FAIL — a median fell below its recorded floor:\n");
  for (const f of regressions) console.error(`  ${f}`);
  console.error(
    "\nRaise the page, not the floor. A threshold lowered to accommodate a regression\n" +
      "records that the regression happened and then stops mentioning it.\n",
  );
  process.exit(1);
}

console.log(
  `OK — ${results.length} routes, ${PRESET} preset, median of ${RUNS} runs each, ` +
    `none below its floor.`,
);

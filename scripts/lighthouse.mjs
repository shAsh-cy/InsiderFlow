#!/usr/bin/env node
/**
 * Lighthouse, committed and runnable — with medians, because one run is noise.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Ten UI revisions were built against "performance median 100, a11y 100".
 * r15 went looking for the config that produced those numbers and there
 * was none: no `lighthouserc`, no runner, nothing in CI. The figures came
 * from uncommitted scratchpad scripts, so nothing a fresh clone could run
 * would reproduce them — which makes them recollections, not measurements.
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
 * TWO NUMBERS PER ROUTE, AND THEY DISAGREE.
 *
 * `goal` is the bar this project has claimed for ten revisions: perf 95
 * (92 for `/design`), a11y 100.
 *
 * `floor` is what the routes MEASURED the first time anyone ran a
 * committed Lighthouse — mobile preset, median of 3, on a developer
 * machine on 2026-08-19. Accessibility met its goal everywhere, at a clean
 * 100. Performance did not come close on either preset:
 *
 *              mobile   desktop   goal
 *   /             --       78      95
 *   /trades       --       89      95
 *   /screener     --       61      95
 *   /stock/ZZ..   73       75      95
 *   /design       72       70      92
 *
 * The gate fails on a drop below `floor`, so a regression is caught. It
 * PRINTS the gap to `goal` on every run and never closes it by moving it,
 * because a threshold quietly lowered to fit a regression records that the
 * regression happened and then stops mentioning it.
 *
 * Two honest caveats, both of which make these numbers a lower bound: the
 * measurements were taken on a loaded workstation (builds, a dev server
 * and two browsers were live), and a quiet CI runner will score higher.
 * Neither excuses the gap — they mean the gap needs re-measuring somewhere
 * quiet before anyone concludes how large it really is.
 *
 * `/stock/ZZNOVA` uses a synthetic fixture on purpose: a real ticker would
 * make the gate depend on which company happened to be seeded.
 */
const TARGETS = [
  {
    route: "/",
    goal: { performance: 95, accessibility: 100 },
    floor: { performance: 70, accessibility: 100 },
  },
  {
    route: "/trades",
    goal: { performance: 95, accessibility: 100 },
    floor: { performance: 70, accessibility: 100 },
  },
  {
    route: "/screener",
    goal: { performance: 95, accessibility: 100 },
    floor: { performance: 55, accessibility: 100 },
  },
  {
    route: "/stock/ZZNOVA",
    goal: { performance: 95, accessibility: 100 },
    floor: { performance: 65, accessibility: 100 },
  },
  // Every primitive plus a 10k-row virtualised table, by design.
  {
    route: "/design",
    goal: { performance: 92, accessibility: 100 },
    floor: { performance: 62, accessibility: 100 },
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

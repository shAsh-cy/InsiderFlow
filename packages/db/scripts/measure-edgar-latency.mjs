#!/usr/bin/env node
/**
 * Filing → visible latency, measured against LIVE EDGAR.
 *
 * ── WHY THIS EXISTS AS A MEASUREMENT AND NOT A CLAIM ──────────────────
 *
 * "~72s worst case" had been carried forward in documentation for several
 * rounds without anything producing the number. This project has already
 * been bitten by that shape once: five security headers were recorded as
 * shipped and only one had. A latency figure nobody measures is the same
 * class of claim.
 *
 * ── THREE TERMS, AND ONLY ONE OF THEM IS OURS ─────────────────────────
 *
 * The first version of this script measured `acceptanceTime → visible`
 * and reported 45,492 seconds. That number is real and it is not latency.
 * The newest filing EDGAR had was accepted at 18:31 ET the previous
 * evening; filings accepted after 17:30 ET are disseminated the NEXT
 * business morning, so 12.6 hours of it was EDGAR waiting, and none of it
 * was us. A threshold on that figure would fail every morning and pass
 * every afternoon, which is worse than no threshold at all.
 *
 * So the terms are separated:
 *
 *   DISSEMINATION  acceptance → first appearance in the public feed.
 *                  EDGAR's, not ours. Reported, never asserted on.
 *   DETECTION      first appearance in the feed → our row is queryable.
 *                  OURS. This is what "filing → visible" can honestly
 *                  mean for this system, and what the threshold guards.
 *   PIPELINE       run start → row queryable. A subset of detection,
 *                  useful for telling a parser regression apart from a
 *                  cron-cadence change.
 *
 * Measuring detection requires WATCHING: a filing already sitting in the
 * feed when the script starts cannot tell us when we would have first
 * seen it. So the script polls until a genuinely new accession appears,
 * and reports "nothing arrived" rather than a number if none does.
 *
 * ── AGAINST A THROWAWAY DATABASE, ON PURPOSE ──────────────────────────
 *
 * PGlite with the real migrations, never the dev database. Ingesting real
 * EDGAR filings into the seeded dev database would put non-synthetic rows
 * beside the ZZ* fixtures and break the honesty invariant that synthetic
 * data never reaches analytics — a measurement that corrupts the thing it
 * measures.
 *
 * Usage:
 *   EDGAR_USER_AGENT="InsiderFlow/0.1 (you@example.com)" \
 *     pnpm measure:edgar-latency [--max-seconds=180] [--forms=4]
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// packages/db/scripts -> repo root is three up.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/**
 * The documented ceiling, and what it is made of.
 *
 * 60s of cron interval + a generous 120s for discovery, fetch, parse and
 * insert. Deliberately well above the expected figure: this is a
 * REGRESSION threshold, not a target. A gate that trips on ordinary
 * variance in someone else's service teaches people to ignore it, and
 * EDGAR's own response time is the largest term we do not control.
 */
const MAX_SECONDS = Number(arg("max-seconds", "180"));

const userAgent = process.env.EDGAR_USER_AGENT;
if (!userAgent || !userAgent.includes("@")) {
  console.error(
    "EDGAR_USER_AGENT must be set to a descriptive UA containing a contact address.\n" +
      "This is not a formality: the SEC fair-access policy requires it, and a generic\n" +
      "User-Agent is answered with HTTP 503 — measured, while writing this script.",
  );
  process.exit(1);
}

const log = (event, data) => console.log(JSON.stringify({ event, ...data }));

const client = new PGlite({ extensions: { pg_trgm } });
await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
const db = drizzle(client);
await migrate(db, { migrationsFolder: resolve(root, "packages/db/drizzle") });

// `pathToFileURL`, not a raw path: on Windows the ESM loader rejects
// `c:\...` with ERR_UNSUPPORTED_ESM_URL_SCHEME because it reads the drive
// letter as a protocol.
const { ingestFromFeed } = await import(
  pathToFileURL(resolve(root, "ingestion/edgar-worker/src/pipeline.ts")).href
);
const { filings, transactions, sql } = await import("@insiderflow/db");

const WATCH_SECONDS = Number(arg("watch-seconds", "600"));
const POLL_SECONDS = 20;

// By file URL for the same reason as the pipeline above: `@insiderflow/core`
// is not a dependency of this package, and adding one so a measurement
// script can resolve it would change the shipped dependency graph.
const { edgarCurrentFeedUrl } = await import(
  pathToFileURL(resolve(root, "packages/core/src/index.ts")).href
);

/** Accession numbers currently in the public feed, with our observation time. */
async function feedAccessions() {
  const response = await fetch(edgarCurrentFeedUrl(arg("forms", "4")), {
    headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate" },
  });
  if (!response.ok) throw new Error(`EDGAR feed answered ${response.status}`);
  const xml = await response.text();
  return new Set([...xml.matchAll(/accession-nu?mber>([0-9-]{18,20})</g)].map((m) => m[1]));
}

log("edgar_latency_watch_start", { watchSeconds: WATCH_SECONDS, pollSeconds: POLL_SECONDS });

// The baseline. Anything here already existed before we looked, so its
// detection latency is unknowable and it is excluded.
const baseline = await feedAccessions();
log("edgar_latency_baseline", { known: baseline.size });

let arrival = null;
const deadline = Date.now() + WATCH_SECONDS * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  let current;
  try {
    current = await feedAccessions();
  } catch (error) {
    log("edgar_feed_error", { message: String(error) });
    continue;
  }
  const fresh = [...current].filter((a) => !baseline.has(a));
  if (fresh.length > 0) {
    // First observation time: the poll that saw it. Granularity is the
    // poll interval, which is stated in the output rather than hidden —
    // polling faster would be more precise and less polite to the SEC.
    arrival = { accessionNo: fresh[0], firstSeenAt: Date.now(), alsoNew: fresh.length - 1 };
    log("edgar_latency_arrival", arrival);
    break;
  }
  log("edgar_latency_waiting", { secondsLeft: Math.round((deadline - Date.now()) / 1000) });
}

if (!arrival) {
  console.error(
    [
      "",
      `No new filing appeared in ${WATCH_SECONDS}s, so detection latency was not measured.`,
      "",
      "This is a legitimate outcome — EDGAR publishes on business days, roughly",
      "06:00-22:00 ET, and Form 4 arrivals are bursty around the close. It is NOT a",
      "pass: nothing was measured, and reporting a number here would be inventing one.",
      "",
    ].join("\n"),
  );
  log("edgar_latency_no_arrival", { watchSeconds: WATCH_SECONDS });
  await client.close();
  process.exit(2);
}

const startedAt = Date.now();

log("edgar_latency_run_start", { maxSeconds: MAX_SECONDS, forms: arg("forms", "4") });

const stats = await ingestFromFeed({
  db,
  userAgent,
  forms: [arg("forms", "4")],
  // The real defaults; measuring a tuned-up configuration would measure
  // something the deployment does not run.
  log: (event, data) => log(event, data),
});

const pipelineSeconds = (Date.now() - startedAt) / 1000;

const rows = await db
  .select({
    accessionNo: filings.accessionNo,
    filedAt: filings.filedAt,
    createdAt: filings.createdAt,
  })
  .from(filings)
  .orderBy(sql`${filings.filedAt} desc`)
  .limit(5);

const txCount = await db.select({ n: sql`count(*)`.mapWith(Number) }).from(transactions);

if (rows.length === 0) {
  console.error(
    "\nNo filing was ingested, so there is no latency to report.\n" +
      "This is a legitimate outcome outside EDGAR's publishing window (business days,\n" +
      "roughly 06:00-22:00 ET) — but it is NOT a pass, because nothing was measured.",
  );
  log("edgar_latency_no_data", { ...stats, pipelineSeconds });
  await client.close();
  process.exit(2);
}

const ingestedRow = rows.find((r) => r.accessionNo === arrival.accessionNo) ?? null;
const newest = rows[0];

// Detection is measured on the filing we WATCHED arrive. If the drain did
// not reach it this run (the per-run cap is real), say so rather than
// silently measuring a different filing.
const measured = ingestedRow ?? null;
const detectionSeconds = measured ? (Date.now() - arrival.firstSeenAt) / 1000 : null;
const disseminationSeconds = measured
  ? (arrival.firstSeenAt - new Date(measured.filedAt).getTime()) / 1000
  : null;

log("edgar_latency_measured", {
  watchedAccession: arrival.accessionNo,
  ingested: Boolean(measured),
  detectionSeconds: detectionSeconds === null ? null : Math.round(detectionSeconds),
  disseminationSeconds: disseminationSeconds === null ? null : Math.round(disseminationSeconds),
  pipelineSeconds: Math.round(pipelineSeconds * 10) / 10,
  pollGranularitySeconds: POLL_SECONDS,
  discovered: stats.discovered,
  ingestedCount: stats.ingested,
  transactions: txCount[0]?.n ?? 0,
  newestHeld: newest.accessionNo,
});

console.log(
  [
    "",
    "── EDGAR filing → visible ─────────────────────────────────────────",
    `  watched arrival      ${arrival.accessionNo}`,
    `  ingested this run    ${measured ? "yes" : "NO — still queued, see below"}`,
    measured
      ? `  DETECTION (ours)     ${Math.round(detectionSeconds)}s   (threshold ${MAX_SECONDS}s, +/-${POLL_SECONDS}s poll granularity)`
      : "  DETECTION (ours)     not measured",
    measured && disseminationSeconds !== null
      ? `  dissemination (SEC)  ${Math.round(disseminationSeconds)}s   — EDGAR's own delay, not ours`
      : "",
    `  pipeline only        ${Math.round(pipelineSeconds * 10) / 10}s`,
    `  discovered/ingested  ${stats.discovered}/${stats.ingested}`,
    "",
  ]
    .filter(Boolean)
    .join("\n"),
);

await client.close();

if (detectionSeconds !== null && detectionSeconds > MAX_SECONDS) {
  console.error(
    `FAIL: ${Math.round(detectionSeconds)}s exceeds the ${MAX_SECONDS}s ceiling.\n` +
      "Check discovery paging, the pending-filings drain rate, and EDGAR's own latency\n" +
      "before assuming the parser regressed.",
  );
  process.exit(1);
}

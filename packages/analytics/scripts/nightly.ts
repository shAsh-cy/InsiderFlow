/**
 * The nightly analytics runner (GitHub Actions — see
 * .github/workflows/analytics.yml).
 *
 * Deliberately NOT on the Cloudflare cron: the worker already uses two of its
 * five free triggers, none of this work has a 60-second SLA, and several
 * steps pull tens of megabytes or make hundreds of rate-limited requests —
 * which is exactly what a scheduled Action is for and exactly what a
 * per-minute Worker invocation is not.
 *
 * Every step is independent and failure-isolated: one bad source must not
 * cost the rest of the night's work. Exit code is non-zero only if EVERY
 * step failed, so a transient upstream outage does not turn the repo red.
 *
 *   pnpm --filter @insiderflow/analytics nightly
 *   pnpm --filter @insiderflow/analytics nightly -- --only=sectors,scoring
 */
import {
  backfillSectors,
  computeAnomalies,
  fillPriceHistoryGaps,
  ingestPoliticianTrades,
  relinkPoliticianCompanies,
  scoreTrades,
  sweepClusterFlags,
} from "../src/index";
import { createDbHandle } from "@insiderflow/db";

const log = (event: string, data?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
};

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const userAgent = process.env.EDGAR_USER_AGENT ?? "InsiderFlow/0.1 (analytics@insiderflow.dev)";
// `--only=` with no value (what a blank workflow_dispatch input produces) has
// to mean "everything", not "nothing".
const only = (arg("only") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const shouldRun = (step: string): boolean => only.length === 0 || only.includes(step);

const handle = createDbHandle(databaseUrl);
const db = handle.db;

interface StepOutcome {
  step: string;
  ok: boolean;
  detail?: unknown;
}

async function run(step: string, fn: () => Promise<unknown>): Promise<StepOutcome | null> {
  if (!shouldRun(step)) return null;
  const started = Date.now();
  try {
    const detail = await fn();
    log(`${step}_ok`, { durationMs: Date.now() - started, detail });
    return { step, ok: true, detail };
  } catch (error) {
    log(`${step}_failed`, {
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    });
    return { step, ok: false };
  }
}

try {
  const outcomes: StepOutcome[] = [];
  const push = (o: StepOutcome | null) => {
    if (o) outcomes.push(o);
  };

  // ORDER MATTERS:
  //  1. sectors    — heatmap grouping needs them
  //  2. politicians— relink runs after any new companies exist
  //  3. prices     — scoring cannot compute a return without history
  //  4. scoring    — consumes the price history filled above
  //  5. anomalies  — independent, but cheap and last
  //  6. clusters   — repairs flags the per-minute pass could not reach
  push(
    await run("sectors", () =>
      backfillSectors({ db, userAgent, limit: Number(arg("sectorLimit") ?? 300), log }),
    ),
  );

  push(
    await run("politicians", async () => {
      // The bundled default sources went dark (docs/politicians.md); these let
      // an operator point at any source they have the rights to use.
      const ingest = await ingestPoliticianTrades({
        db,
        houseUrl: process.env.HOUSE_PTR_URL,
        senateUrl: process.env.SENATE_PTR_URL,
        log,
      });
      const relinked = await relinkPoliticianCompanies(db);
      if (ingest.failedSources.length > 0 && ingest.fetched === 0) {
        // Fetching nothing from every source is a failure, not a quiet success
        // — otherwise a dead upstream looks identical to a quiet news day.
        throw new Error(
          `no congressional data ingested; sources failed: ${ingest.failedSources.join(", ")}`,
        );
      }
      return { ...ingest, relinked };
    }),
  );

  push(
    await run("prices", () =>
      fillPriceHistoryGaps({ db, limit: Number(arg("priceLimit") ?? 60), log }),
    ),
  );

  push(await run("scoring", () => scoreTrades({ db, log })));
  push(await run("anomalies", () => computeAnomalies({ db, log })));
  push(await run("clusters", () => sweepClusterFlags(db)));

  const failed = outcomes.filter((o) => !o.ok);
  log("nightly_complete", {
    steps: outcomes.length,
    failed: failed.map((f) => f.step),
  });

  // Red only when nothing worked — a single flaky upstream is not a build break.
  if (outcomes.length > 0 && failed.length === outcomes.length) {
    process.exitCode = 1;
  }
} finally {
  await handle.end();
}

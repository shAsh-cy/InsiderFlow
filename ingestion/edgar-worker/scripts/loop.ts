/**
 * The worker's scheduled() body, on a plain interval.
 *
 * Production runs this as a Cloudflare Worker cron trigger. This exists for
 * the Docker stack and for anyone running ingestion on a VPS (see SCALING.md)
 * — `wrangler dev` needs Cloudflare's workerd sandbox, which is heavy and
 * awkward inside a container, and the pipeline itself is plain TypeScript.
 *
 * Same code path as the worker: ingest → cluster flags → alert scan →
 * dispatch → secondary sources → price enrichment.
 *
 *   DATABASE_URL=... EDGAR_USER_AGENT='You <you@example.com>' \
 *     pnpm --filter @insiderflow/edgar-worker ingest:loop
 */
import {
  dispatchDigestExclusive,
  dispatchInstant,
  scanClusterAlerts,
  scanForMatches,
  scanPoliticianAlerts,
} from "@insiderflow/alerts";
import { maintainClusterFlags } from "@insiderflow/analytics";
import { createDbHandle } from "@insiderflow/db";

import { enrichRecentPrices } from "../src/enrich";
import { createCachedFetch, jsonLogger, RateLimiter } from "../src/http";
import { ingestFromFeed } from "../src/pipeline";
import { runSecondarySources } from "../src/sources";

const env = process.env;
const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const userAgent = env.EDGAR_USER_AGENT;
if (!userAgent || userAgent.includes("set-your-email")) {
  // The SEC fair-access policy requires a real contact address. Refusing here
  // is friendlier than getting the deployment's IP blocked.
  console.error(
    'EDGAR_USER_AGENT must identify you, e.g. "InsiderFlow/0.1 (you@example.com)".\n' +
      "See https://www.sec.gov/os/accessing-edgar-data",
  );
  process.exit(1);
}

const intervalMs = Number(env.INGEST_INTERVAL_SECONDS ?? 60) * 1000;
const digestEveryMs = 3600_000;
let lastDigestAt = 0;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    jsonLogger("loop_stopping", { signal });
    stopping = true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One tick. Every stage is failure-isolated: one bad source must not stop the rest. */
async function tick(): Promise<void> {
  const handle = createDbHandle(databaseUrl!);
  const started = Date.now();
  try {
    try {
      const stats = await ingestFromFeed({
        db: handle.db,
        userAgent: userAgent!,
        maxFilings: env.MAX_FILINGS_PER_RUN ? Number(env.MAX_FILINGS_PER_RUN) : undefined,
        maxDiscoveryPages: env.MAX_DISCOVERY_PAGES ? Number(env.MAX_DISCOVERY_PAGES) : undefined,
      });
      jsonLogger("cron_complete", { durationMs: Date.now() - started, ...stats });
    } catch (error) {
      jsonLogger("edgar_ingest_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const clusters = await maintainClusterFlags(handle.db);
      if (clusters.cursorAdvanced) jsonLogger("cluster_flags_updated", { ...clusters });
    } catch (error) {
      jsonLogger("cluster_flags_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const maxAge = env.ALERT_INSTANT_MAX_AGE ? Number(env.ALERT_INSTANT_MAX_AGE) : undefined;
      const scan = await scanForMatches({
        db: handle.db,
        owner: "docker-loop",
        instantMaxAgeMinutes: maxAge,
        log: jsonLogger,
      });
      if (scan.acquired) {
        await scanClusterAlerts({ db: handle.db, instantMaxAgeMinutes: maxAge, log: jsonLogger });
        await scanPoliticianAlerts({
          db: handle.db,
          instantMaxAgeMinutes: maxAge,
          log: jsonLogger,
        });
        await dispatchInstant({
          db: handle.db,
          siteUrl: env.SITE_URL ?? "http://localhost:3000",
          telegramBotToken: env.TELEGRAM_BOT_TOKEN,
          resendApiKey: env.RESEND_API_KEY,
          resendFrom: env.RESEND_FROM,
          log: jsonLogger,
        });
      }
    } catch (error) {
      jsonLogger("alert_pipeline_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // Hourly, matching the worker's second cron trigger.
    if (Date.now() - lastDigestAt >= digestEveryMs) {
      lastDigestAt = Date.now();
      try {
        const stats = await dispatchDigestExclusive({
          db: handle.db,
          owner: "docker-loop",
          siteUrl: env.SITE_URL ?? "http://localhost:3000",
          telegramBotToken: env.TELEGRAM_BOT_TOKEN,
          resendApiKey: env.RESEND_API_KEY,
          resendFrom: env.RESEND_FROM,
          log: jsonLogger,
        });
        jsonLogger("digest_complete", { ...stats });
      } catch (error) {
        jsonLogger("digest_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await runSecondarySources(handle.db, env, jsonLogger);

    try {
      const priceFetch = createCachedFetch({
        db: handle.db,
        ttlSeconds: 24 * 3600,
        limiter: new RateLimiter(500),
      });
      await enrichRecentPrices(handle.db, priceFetch, { limit: 10 });
    } catch (error) {
      jsonLogger("price_enrichment_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    await handle.end();
  }
}

jsonLogger("loop_started", { intervalSeconds: intervalMs / 1000 });
while (!stopping) {
  try {
    await tick();
  } catch (error) {
    // Never let one bad tick kill the loop.
    jsonLogger("loop_tick_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (stopping) break;
  await sleep(intervalMs);
}
jsonLogger("loop_stopped");

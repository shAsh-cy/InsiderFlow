import {
  dispatchDigestExclusive,
  dispatchInstant,
  scanClusterAlerts,
  scanForMatches,
  scanPoliticianAlerts,
} from "@insiderflow/alerts";
import { maintainClusterFlags } from "@insiderflow/analytics";
import { createDbHandle, eq, ingestionState } from "@insiderflow/db";

import { enrichRecentPrices } from "./enrich";
import { createCachedFetch, jsonLogger, RateLimiter } from "./http";
import { ingestFromFeed } from "./pipeline";
import { runSecondarySources } from "./sources";

export interface Env {
  /** Postgres URL — Supabase transaction-pooler in prod, local docker in dev. */
  DATABASE_URL: string;
  /** Required by the SEC fair-access policy, e.g. "InsiderFlow/0.1 (you@example.com)". */
  EDGAR_USER_AGENT: string;
  /** Optional override; keep the default well under the 50 subrequests/invocation free-tier cap. */
  MAX_FILINGS_PER_RUN?: string;
  /**
   * How many 100-item feed pages discovery walks back per form. Shares the
   * same subrequest budget as MAX_FILINGS_PER_RUN: forms x pages + filings
   * must stay under 50.
   */
  MAX_DISCOVERY_PAGES?: string;
  /** Optional secondary sources (see src/sources.ts for intervals and caching). */
  FINNHUB_API_KEY?: string;
  FMP_API_KEY?: string;
  WATCHLIST_SYMBOLS?: string;
  /** Licensed NSE/BSE disclosure feed — see the IndiaAdapter legal note. */
  INDIA_FEED_URL?: string;

  // ── Alerting (Phase 7) ──────────────────────────────────────────────────
  /** Public site origin, used in email links. */
  SITE_URL?: string;
  /** Primary alert channel — free and unlimited. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Email is capped (Resend free tier: 100/day), so it batches into digests. */
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  /**
   * Minutes an event may be old and still fire instantly (default 60).
   * Anything older routes to the digest, so a cursor reset or a backfill
   * cannot push a month of historical trades as breaking news.
   */
  ALERT_INSTANT_MAX_AGE?: string;
}

/**
 * Alert scanning rides the existing 1-minute cron (see the runtime choice
 * in docs/alerts.md): the worker already has a DB handle open, and a
 * second Cloudflare cron trigger costs nothing on the free plan.
 */
async function runAlertPipeline(
  db: Parameters<typeof scanForMatches>[0]["db"],
  env: Env,
): Promise<void> {
  try {
    const scan = await scanForMatches({
      db,
      owner: "cf-worker",
      instantMaxAgeMinutes: env.ALERT_INSTANT_MAX_AGE
        ? Number(env.ALERT_INSTANT_MAX_AGE)
        : undefined,
      log: jsonLogger,
    });
    if (!scan.acquired) return; // another runner holds the lease

    // Derived feeds ride the same lease, so they cannot overlap either.
    const maxAge = env.ALERT_INSTANT_MAX_AGE ? Number(env.ALERT_INSTANT_MAX_AGE) : undefined;
    await scanClusterAlerts({ db, instantMaxAgeMinutes: maxAge, log: jsonLogger });
    await scanPoliticianAlerts({ db, instantMaxAgeMinutes: maxAge, log: jsonLogger });

    // Always dispatch, even when this scan logged nothing: earlier runs can
    // leave rows pending (a channel outage, a retry), and this pass is also
    // what retires alerts whose subject has since been deleted.
    await dispatchInstant({
      db,
      siteUrl: env.SITE_URL ?? "https://insiderflow.dev",
      telegramBotToken: env.TELEGRAM_BOT_TOKEN,
      resendApiKey: env.RESEND_API_KEY,
      resendFrom: env.RESEND_FROM,
      log: jsonLogger,
    });
  } catch (error) {
    jsonLogger("alert_pipeline_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Must match the second entry in wrangler.jsonc `triggers.crons`. */
const DIGEST_CRON = "0 * * * *";

export default {
  // Runs every minute; a filing appearing in the EDGAR feed lands in the DB
  // within one cron tick plus a few seconds of processing (< 2 min end to end).
  async scheduled(event, env, _ctx): Promise<void> {
    const started = Date.now();
    const handle = createDbHandle(env.DATABASE_URL);
    try {
      // Daily digest runs on its own cron; it must not re-run ingestion.
      if (event.cron === DIGEST_CRON) {
        // Exclusive: a GitHub Actions backstop can flush digests too, and two
        // runners without a lease would send the same batch twice.
        const stats = await dispatchDigestExclusive({
          db: handle.db,
          owner: "cf-worker",
          siteUrl: env.SITE_URL ?? "https://insiderflow.dev",
          telegramBotToken: env.TELEGRAM_BOT_TOKEN,
          resendApiKey: env.RESEND_API_KEY,
          resendFrom: env.RESEND_FROM,
          log: jsonLogger,
        });
        jsonLogger("digest_complete", { cron: event.cron, ...stats });
        return;
      }

      // Primary source: EDGAR. A failure here must not block the others.
      try {
        const stats = await ingestFromFeed({
          db: handle.db,
          userAgent: env.EDGAR_USER_AGENT,
          maxFilings: env.MAX_FILINGS_PER_RUN ? Number(env.MAX_FILINGS_PER_RUN) : undefined,
          maxDiscoveryPages: env.MAX_DISCOVERY_PAGES ? Number(env.MAX_DISCOVERY_PAGES) : undefined,
        });
        jsonLogger("cron_complete", {
          cron: event.cron,
          durationMs: Date.now() - started,
          ...stats,
        });
      } catch (error) {
        jsonLogger("edgar_ingest_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Cluster flags, incrementally. Folded into this cron rather than given
      // a third trigger: it is O(rows created since the cursor), so it costs
      // nothing on a quiet minute, and cluster alerts below need it fresh.
      // The nightly GitHub Actions sweep repairs flags that aged out without
      // new trades to trigger a recompute.
      try {
        const clusters = await maintainClusterFlags(handle.db);
        if (clusters.cursorAdvanced) jsonLogger("cluster_flags_updated", { ...clusters });
      } catch (error) {
        jsonLogger("cluster_flags_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Alerts: scan everything new (from ANY writer) and dispatch instants.
      await runAlertPipeline(handle.db, env);

      // Secondary sources (Finnhub / FMP / India) — interval-gated internally.
      await runSecondarySources(handle.db, env, jsonLogger);

      // Price context for recent opportunistic trades (cached, capped).
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
  },

  // Health check: reports the last ingestion cursor.
  async fetch(_request, env): Promise<Response> {
    const handle = createDbHandle(env.DATABASE_URL);
    try {
      const [cursor] = await handle.db
        .select()
        .from(ingestionState)
        .where(eq(ingestionState.key, "edgar:cursor"));
      return Response.json({
        service: "insiderflow-edgar-worker",
        status: "ok",
        lastRun: cursor?.value ?? null,
      });
    } catch (error) {
      return Response.json(
        {
          service: "insiderflow-edgar-worker",
          status: "degraded",
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    } finally {
      await handle.end();
    }
  },
} satisfies ExportedHandler<Env>;

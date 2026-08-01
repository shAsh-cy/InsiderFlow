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
  /** Optional secondary sources (see src/sources.ts for intervals and caching). */
  FINNHUB_API_KEY?: string;
  FMP_API_KEY?: string;
  WATCHLIST_SYMBOLS?: string;
  /** Licensed NSE/BSE disclosure feed — see the IndiaAdapter legal note. */
  INDIA_FEED_URL?: string;
}

export default {
  // Runs every minute; a filing appearing in the EDGAR feed lands in the DB
  // within one cron tick plus a few seconds of processing (< 2 min end to end).
  async scheduled(event, env, _ctx): Promise<void> {
    const started = Date.now();
    const handle = createDbHandle(env.DATABASE_URL);
    try {
      // Primary source: EDGAR. A failure here must not block the others.
      try {
        const stats = await ingestFromFeed({
          db: handle.db,
          userAgent: env.EDGAR_USER_AGENT,
          maxFilings: env.MAX_FILINGS_PER_RUN ? Number(env.MAX_FILINGS_PER_RUN) : undefined,
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

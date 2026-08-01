/**
 * Secondary source sync: Finnhub, FMP, and the operator-supplied India feed.
 * Each source runs on its own interval (gated in ingestion_state), behind a
 * DB-backed response cache and a per-source rate limiter, and persists
 * through the same UnifiedTransaction path as EDGAR — cross-source
 * duplicates die on the dedup_key unique index.
 */
import { finnhubAdapter, fmpAdapter, indiaAdapter } from "@insiderflow/core";
import { apiCache, eq, ingestionState } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { makeFxRateLookup } from "./enrich";
import { createCachedFetch, jsonLogger, RateLimiter } from "./http";
import type { Logger } from "./http";
import { persistUnified } from "./pipeline";

export interface SecondarySourceEnv {
  FINNHUB_API_KEY?: string;
  FMP_API_KEY?: string;
  /** Comma-separated symbols shared by the symbol-scoped sources. */
  WATCHLIST_SYMBOLS?: string;
  /** Licensed NSE/BSE disclosure feed (see IndiaAdapter legal note). */
  INDIA_FEED_URL?: string;
}

/** Interval gate stored in ingestion_state; marks the run BEFORE fetching so failures cannot burn API budgets in a loop. */
async function claimRun(db: Database, key: string, intervalMs: number): Promise<boolean> {
  const [row] = await db.select().from(ingestionState).where(eq(ingestionState.key, key));
  const last = typeof row?.value.at === "string" ? Date.parse(row.value.at) : 0;
  if (Number.isFinite(last) && Date.now() - last < intervalMs) return false;

  const value = { at: new Date().toISOString() };
  await db
    .insert(ingestionState)
    .values({ key, value })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: { value, updatedAt: new Date() },
    });
  return true;
}

export async function runSecondarySources(
  db: Database,
  env: SecondarySourceEnv,
  log: Logger = jsonLogger,
): Promise<void> {
  const symbols = (env.WATCHLIST_SYMBOLS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // Historical FX rates never change → cache for a week.
  const fxFetch = createCachedFetch({ db, ttlSeconds: 7 * 86_400 });
  const fxRateLookup = makeFxRateLookup(db, fxFetch, log);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // Finnhub free tier: 60 calls/min, 30/sec burst → 1.1s spacing keeps us
  // under both. Watchlist syncs every 15 min; responses cached 6h.
  if (env.FINNHUB_API_KEY && symbols.length > 0) {
    if (await claimRun(db, "finnhub:last_sync", 15 * 60_000)) {
      try {
        const fetchFn = createCachedFetch({
          db,
          ttlSeconds: 6 * 3600,
          limiter: new RateLimiter(1100),
          log,
        });
        const ctx = { fetchFn, apiKey: env.FINNHUB_API_KEY, symbols, since, log };
        const txns = finnhubAdapter.normalize(await finnhubAdapter.fetch(ctx));
        const stats = await persistUnified(txns, { db, log, fxRateLookup });

        // Insider-sentiment (MSPR): cached per symbol for the UI.
        const points = await finnhubAdapter.fetchSentiment(ctx, since, today);
        for (const symbol of symbols) {
          const symbolPoints = points.filter((p) => p.symbol === symbol);
          if (symbolPoints.length === 0) continue;
          const now = new Date();
          await db
            .insert(apiCache)
            .values({
              key: `finnhub:sentiment:${symbol}`,
              payload: { points: symbolPoints },
              expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
              fetchedAt: now,
            })
            .onConflictDoUpdate({
              target: apiCache.key,
              set: {
                payload: { points: symbolPoints },
                expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
                fetchedAt: now,
              },
            });
        }
        log("finnhub_sync", {
          symbols: symbols.length,
          normalized: txns.length,
          sentimentPoints: points.length,
          ...stats,
        });
      } catch (error) {
        log("finnhub_sync_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // FMP free tier is ~250 calls/day → sync every 6h, 2s spacing, 12h cache.
  if (env.FMP_API_KEY && symbols.length > 0) {
    if (await claimRun(db, "fmp:last_sync", 6 * 3600_000)) {
      try {
        const fetchFn = createCachedFetch({
          db,
          ttlSeconds: 12 * 3600,
          limiter: new RateLimiter(2000),
          log,
        });
        const txns = fmpAdapter.normalize(
          await fmpAdapter.fetch({ fetchFn, apiKey: env.FMP_API_KEY, symbols, since, log }),
        );
        const stats = await persistUnified(txns, { db, log, fxRateLookup });
        log("fmp_sync", { symbols: symbols.length, normalized: txns.length, ...stats });
      } catch (error) {
        log("fmp_sync_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // India: operator-supplied licensed feed, refreshed every 6h.
  if (env.INDIA_FEED_URL) {
    if (await claimRun(db, "nse-bse:last_sync", 6 * 3600_000)) {
      try {
        const fetchFn = createCachedFetch({
          db,
          ttlSeconds: 3600,
          limiter: new RateLimiter(1000),
          log,
        });
        const txns = indiaAdapter.normalize(
          await indiaAdapter.fetch({ fetchFn, feedUrl: env.INDIA_FEED_URL, log }),
        );
        const stats = await persistUnified(txns, { db, log, fxRateLookup });
        log("india_sync", { normalized: txns.length, ...stats });
      } catch (error) {
        log("india_sync_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

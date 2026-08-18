/**
 * CLI entry: `pnpm india:ingest [--days=7]` or `pnpm india:ingest --smoke`.
 *
 * Designed for a residential machine / home server on Node 20+ — NOT the
 * Cloudflare Worker (exchanges block datacenter IPs). Refuses to run unless
 * ENABLE_INDIA_INGEST=true (see README for the legal posture).
 */
import {
  NSE_PIT_REFERER,
  NSE_PRIME_URL,
  nseBulkBlockUrl,
  nsePitUrl,
  nsePledgeUrl,
  nseSastUrl,
} from "@insiderflow/core";
import { createGuardedFetch } from "@insiderflow/core/ssrf-fetch";
import { createDbHandle } from "@insiderflow/db";
import { makeFxRateLookup } from "@insiderflow/edgar-worker/enrich";
import { createCachedFetch, jsonLogger, RateLimiter } from "@insiderflow/edgar-worker/http";

import { fetchBseAnnouncements } from "./bse";
import { assertIndiaIngestEnabled, IndiaIngestDisabledError, runIndiaIngest } from "./ingest";
import { NseSession } from "./session";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Every outbound request this CLI makes, through the guard.
 *
 * This process runs on somebody's home machine, on their home network, by
 * design — the exchanges block datacenter IPs, which is the whole reason
 * for the local runner. That makes it the process in this repo with the
 * most interesting things reachable on a private address: a router
 * admin page, a NAS, whatever else is on the LAN. The URLs it builds are
 * compile-time constants from `@insiderflow/core` with date arguments, so
 * nothing here is attacker-chosen today; the guard is what keeps that
 * true if a host is ever made configurable, and what stops an NSE or BSE
 * redirect from leaving the two domains it is supposed to stay on.
 */
const guardedFetch = createGuardedFetch({
  allowedHosts: [
    "api.bseindia.com",
    "nsearchives.nseindia.com",
    "www.bseindia.com",
    "www.nseindia.com",
  ],
});

/**
 * Manual live smoke: prints row counts + first-row keys, writes NOTHING.
 *
 * `--days` matters more than it looks. A seven-day window that returns
 * zero PIT rows has two explanations that this tool exists to tell apart:
 * NSE soft-failing to empty data (what it does to a datacenter IP), or a
 * genuinely quiet week. Widening the window separates them — an empty
 * ninety-day PIT window on an exchange of that size is not a quiet
 * quarter, it is a block. Reported as `days` in every line so a pasted
 * log says what it was asking for.
 */
async function smoke(days: number): Promise<void> {
  const session = new NseSession(guardedFetch);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const targets: Array<[string, string, string]> = [
    ["pit", nsePitUrl(from, to), NSE_PIT_REFERER],
    ["sast", nseSastUrl(from, to), NSE_PRIME_URL],
    ["bulk", nseBulkBlockUrl("bulk_deals", from, to), NSE_PRIME_URL],
    ["pledge", nsePledgeUrl(from, to), NSE_PRIME_URL],
  ];
  for (const [name, url, referer] of targets) {
    try {
      const payload = await session.getJson<{ data?: Array<Record<string, unknown>> }>(
        url,
        referer,
      );
      const rows = payload.data ?? [];
      jsonLogger("smoke_nse", {
        endpoint: name,
        days,
        window: `${from}..${to}`,
        rows: rows.length,
        firstRowKeys: rows[0] ? Object.keys(rows[0]).sort() : [],
      });
    } catch (error) {
      jsonLogger("smoke_nse_failed", {
        endpoint: name,
        days,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    const announcements = await fetchBseAnnouncements(guardedFetch, new RateLimiter(500));
    jsonLogger("smoke_bse", {
      rows: announcements.length,
      firstRowKeys: announcements[0] ? Object.keys(announcements[0]).sort().slice(0, 12) : [],
    });
  } catch (error) {
    jsonLogger("smoke_bse_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  jsonLogger("smoke_done", {
    note: "Compare firstRowKeys against the raw-row types in packages/core/src/adapters/india-scrape.ts before a real run.",
  });
}

async function main(): Promise<void> {
  try {
    assertIndiaIngestEnabled(process.env);
  } catch (error) {
    if (error instanceof IndiaIngestDisabledError) {
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  if (process.argv.includes("--smoke")) {
    await smoke(argValue("days") ? Number(argValue("days")) : 7);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("india-local: DATABASE_URL must be set (point it at your Supabase/Postgres).");
    process.exit(1);
  }

  const handle = createDbHandle(databaseUrl);
  try {
    const fxFetch = createCachedFetch({ db: handle.db, ttlSeconds: 7 * 86_400 });
    const stats = await runIndiaIngest({
      db: handle.db,
      session: new NseSession(guardedFetch),
      bseFetch: guardedFetch,
      fxRateLookup: makeFxRateLookup(handle.db, fxFetch),
      days: argValue("days") ? Number(argValue("days")) : undefined,
      log: jsonLogger,
    });
    if (stats.pit.raw === 0) {
      jsonLogger("india_ingest_warning", {
        note: "NSE returned zero PIT rows — from a datacenter IP NSE soft-fails to empty data. Run `pnpm india:ingest --smoke` and see the README.",
      });
    }
  } finally {
    await handle.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

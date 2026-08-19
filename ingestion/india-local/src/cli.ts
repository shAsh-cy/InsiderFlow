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
  nsePitIndexUrl,
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
 * Both PIT endpoints are probed on purpose. `pit-retired` is the CONTROL:
 * it reports zero every time, from any address, because `corporates-pit`
 * is retired and answers an empty envelope rather than a 404. Printing the
 * two side by side is what turns "we got nothing" into "the endpoint gives
 * nobody anything" — the distinction this repository failed to make for
 * three rounds, attributing it to datacenter IP blocking instead.
 *
 * `--days` widens the window when a count looks low, which separates a
 * quiet week from a broken feed for the endpoints that are still live.
 */
async function smoke(days: number): Promise<void> {
  const session = new NseSession(guardedFetch);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const targets: Array<[string, string, string]> = [
    // Both, deliberately. `pit-retired` is expected to report zero rows —
    // it is the control that shows an empty answer is the endpoint's, not
    // this machine's, which is the confusion that cost three rounds.
    ["pit", nsePitIndexUrl(from, to), NSE_PIT_REFERER],
    ["pit-retired", nsePitUrl(from, to), NSE_PIT_REFERER],
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
    if (stats.pit.filings === 0) {
      jsonLogger("india_ingest_warning", {
        note:
          "The PIT index returned no filings. Run `pnpm india:ingest --smoke`: if `pit` is zero " +
          "while sast/pledge return rows, the index endpoint has moved again — check " +
          "`activeApiName` in the page source. If everything is zero, suspect the session.",
      });
    } else if (stats.pit.documentsFailed > stats.pit.documentsFetched) {
      // Filings found and documents unreadable is a different fault from
      // no filings at all, and it used to produce the same silence.
      jsonLogger("india_ingest_warning", {
        note: `${stats.pit.documentsFailed} of ${stats.pit.filings} PIT documents could not be fetched or parsed.`,
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

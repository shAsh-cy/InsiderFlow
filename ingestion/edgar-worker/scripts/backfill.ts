/**
 * Backfill ownership filings from EDGAR daily form indexes.
 *
 *   pnpm backfill -- --days=30 --forms=4 --max=5000
 *
 * Requires DATABASE_URL and EDGAR_USER_AGENT in the environment. Runs on
 * Node 20+ (uses global fetch); also invoked by .github/workflows/backfill.yml.
 */
import { edgarDailyFormIdxUrl, parseDailyFormIdx } from "@insiderflow/core";
import type { EdgarFilingRef } from "@insiderflow/core";
import { createDbHandle } from "@insiderflow/db";

import { EdgarHttpError, fetchWithRetry, jsonLogger, RateLimiter } from "../src/http";
import type { FetchLike } from "../src/http";
import { ingestFilingRefs } from "../src/pipeline";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const days = Math.max(1, Number(argValue("days") ?? "30"));
const forms = (argValue("forms") ?? "4")
  .split(",")
  .map((f) => f.trim())
  .filter(Boolean);
const max = Math.max(1, Number(argValue("max") ?? "5000"));

const databaseUrl = process.env.DATABASE_URL;
const userAgent = process.env.EDGAR_USER_AGENT;
if (!databaseUrl || !userAgent) {
  console.error("backfill: DATABASE_URL and EDGAR_USER_AGENT must be set");
  process.exit(1);
}

const fetchFn: FetchLike = fetch;

async function main(): Promise<void> {
  const limiter = new RateLimiter(250);
  const headers = { "User-Agent": userAgent!, "Accept-Encoding": "gzip, deflate" };

  const refs: EdgarFilingRef[] = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const day = new Date(now - i * 86_400_000);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // EDGAR publishes business days only

    const url = edgarDailyFormIdxUrl(day);
    await limiter.wait();
    try {
      const response = await fetchWithRetry(fetchFn, url, headers, { log: jsonLogger });
      const dayRefs = parseDailyFormIdx(await response.text(), forms);
      refs.push(...dayRefs);
      jsonLogger("backfill_day", { url, filings: dayRefs.length });
    } catch (error) {
      // Market holidays have no index file.
      if (error instanceof EdgarHttpError && error.status === 404) {
        jsonLogger("backfill_day_missing", { url });
        continue;
      }
      throw error;
    }
  }

  jsonLogger("backfill_discovered", {
    days,
    forms,
    discovered: refs.length,
    processing: Math.min(refs.length, max),
  });

  const handle = createDbHandle(databaseUrl!);
  try {
    const stats = await ingestFilingRefs(refs, {
      db: handle.db,
      userAgent: userAgent!,
      fetchFn,
      maxFilings: max,
      requestDelayMs: 200, // 5 req/s, still well under the 10 req/s cap
      log: jsonLogger,
    });
    jsonLogger("backfill_complete", { ...stats });
    if (stats.errors > 0 && stats.ingested === 0) process.exitCode = 1;
  } finally {
    await handle.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

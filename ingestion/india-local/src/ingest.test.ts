/**
 * Integration test on PGlite with recorded fixtures: flag semantics, and a
 * full mocked run landing PIT (via the UnifiedTransaction path), SAST,
 * bulk/block, and pledge rows — INR native + USD converted — idempotently.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";

import {
  SAMPLE_BSE_ANNOUNCEMENTS,
  SAMPLE_NSE_BULK_ROWS,
  SAMPLE_NSE_PIT_ROWS,
  SAMPLE_NSE_PLEDGE_ROWS,
  SAMPLE_NSE_SAST_ROWS,
} from "@insiderflow/core/fixtures";
import type { FetchLike } from "@insiderflow/core";
import * as dbExports from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { assertIndiaIngestEnabled, IndiaIngestDisabledError, runIndiaIngest } from "./ingest";
import type { NseJsonSession } from "./ingest";

const INR_USD = 0.0114;

const sessionMock: NseJsonSession = {
  getJson<T>(url: string): Promise<T> {
    const payload = url.includes("corporates-pit")
      ? { data: SAMPLE_NSE_PIT_ROWS }
      : url.includes("corporate-sast-reg29")
        ? { data: SAMPLE_NSE_SAST_ROWS }
        : url.includes("corporate-pledgedata")
          ? { data: SAMPLE_NSE_PLEDGE_ROWS }
          : url.includes("optionType=bulk_deals")
            ? { data: SAMPLE_NSE_BULK_ROWS }
            : { data: [] };
    return Promise.resolve(payload as T);
  },
};

const bseFetchMock: FetchLike = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify({ Table: SAMPLE_BSE_ANNOUNCEMENTS })),
  });

describe("flag gate", () => {
  it("refuses to run unless ENABLE_INDIA_INGEST is exactly 'true'", () => {
    expect(() => assertIndiaIngestEnabled({})).toThrow(IndiaIngestDisabledError);
    expect(() => assertIndiaIngestEnabled({ ENABLE_INDIA_INGEST: "false" })).toThrow(
      IndiaIngestDisabledError,
    );
    expect(() => assertIndiaIngestEnabled({ ENABLE_INDIA_INGEST: "1" })).toThrow(
      IndiaIngestDisabledError,
    );
    expect(() => assertIndiaIngestEnabled({ ENABLE_INDIA_INGEST: "true" })).not.toThrow();
  });

  it("names the licensed-feed alternative in the refusal", () => {
    try {
      assertIndiaIngestEnabled({});
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("INDIA_FEED_URL");
      expect((error as Error).message).toContain("OFF by default");
    }
  });
});

describe("runIndiaIngest (PGlite, recorded fixtures)", () => {
  it("lands PIT/SAST/bulk-block/pledge rows normalized with INR + USD, idempotently", async () => {
    const client = new PGlite({ extensions: { pg_trgm } });
    await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    const pgliteDb = drizzle(client, { schema: dbExports });
    const { apply } = await pushSchema(
      { ...dbExports },
      pgliteDb as unknown as Parameters<typeof pushSchema>[1],
    );
    await apply();
    const db = pgliteDb as unknown as Database;

    const options = {
      db,
      session: sessionMock,
      bseFetch: bseFetchMock,
      fxRateLookup: (currency: string) =>
        Promise.resolve(currency === "USD" ? 1 : currency === "INR" ? INR_USD : null),
      log: () => {},
      now: new Date("2026-08-02T10:00:00Z"),
    };

    const stats = await runIndiaIngest(options);
    expect(stats.pit).toMatchObject({ raw: 3, normalized: 2, inserted: 2, deduped: 0 });
    expect(stats.sast).toMatchObject({ raw: 2, inserted: 2 });
    expect(stats.bulkBlock).toMatchObject({ raw: 2, inserted: 2 });
    expect(stats.pledge).toMatchObject({ raw: 2, inserted: 2 });
    expect(stats.bseInsiderAnnouncements).toBe(1);

    // PIT rows went through the SAME path a licensed feed would.
    const txns = await db.select().from(dbExports.transactions);
    expect(txns).toHaveLength(2);
    const buy = txns.find((t) => t.code === "P")!;
    expect(buy).toMatchObject({
      source: "nse-bse",
      country: "IN",
      currency: "INR",
      relevance: "opportunistic",
      shares: "100000.0000",
      value: "245000000.0000",
      valueUsd: "2793000.0000", // 245,00,00,000 INR × 0.0114
    });
    const companies = await db.select().from(dbExports.companies);
    expect(companies.find((c) => c.ticker === "RELIANCE")).toMatchObject({ country: "IN" });

    // SAST with USD conversion.
    const sast = await db.select().from(dbExports.sastDisclosures);
    expect(sast).toHaveLength(2);
    const tata = sast.find((s) => s.symbol === "TATAMOTORS")!;
    expect(tata).toMatchObject({
      country: "IN",
      currency: "INR",
      side: "acquisition",
      regulation: "29(2)",
      shares: "3500000.0000",
      value: null, // corporate-sast-reg29 carries no monetary value
      valueUsd: null,
      sharesPctAfter: "5.9100",
    });

    // Bulk deals with computed INR value + USD.
    const deals = await db.select().from(dbExports.bulkBlockDeals);
    expect(deals).toHaveLength(2);
    const dealBuy = deals.find((d) => d.side === "buy")!;
    expect(dealBuy).toMatchObject({
      dealType: "bulk",
      symbol: "IDEA",
      quantity: "25000000.0000",
      value: "371250000.0000",
      valueUsd: "4232250.0000",
    });

    // Pledge events.
    const pledges = await db.select().from(dbExports.pledgeDisclosures);
    expect(pledges).toHaveLength(2);
    expect(pledges.map((p) => p.eventType).sort()).toEqual(["invoke", "pledge"]);

    // Cursor written.
    const [cursor] = await db
      .select()
      .from(dbExports.ingestionState)
      .where(dbExports.eq(dbExports.ingestionState.key, "india-local:last_run"));
    expect(cursor).toBeDefined();

    // ── Idempotency: the exact same window re-run inserts nothing ─────────
    const second = await runIndiaIngest(options);
    expect(second.pit.inserted).toBe(0);
    expect(second.pit.deduped).toBe(2);
    expect(second.sast.inserted).toBe(0);
    expect(second.bulkBlock.inserted).toBe(0);
    expect(second.pledge.inserted).toBe(0);
    expect(await db.select().from(dbExports.transactions)).toHaveLength(2);
    expect(await db.select().from(dbExports.sastDisclosures)).toHaveLength(2);
    expect(await db.select().from(dbExports.bulkBlockDeals)).toHaveLength(2);
    expect(await db.select().from(dbExports.pledgeDisclosures)).toHaveLength(2);

    await client.close();
  }, 120_000);
});

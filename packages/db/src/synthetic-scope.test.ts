/**
 * The synthetic-fixture gate, against real rows.
 *
 * `excludeSynthetic()` is the whole of the ZZ* promise on aggregate
 * surfaces: the heatmap, the landing counters and the anomaly ranking each
 * compose it and nothing else, so if it stops filtering, a fabricated trade
 * is presented as market data everywhere at once. It had no test.
 *
 * The e2e suite cannot supply one. Every deployment it runs against sets
 * `INSIDERFLOW_SHOW_SYNTHETIC=true` — a locally seeded stack contains
 * nothing BUT fixtures, and hiding them makes `docker compose up` look
 * broken rather than honest — so the one configuration that ships to
 * production, the switch OFF, is the one no HTTP request to that server can
 * reach. It is testable here and only here, because the predicate reads the
 * environment at call time.
 *
 * The case worth writing down is the expensive one: the fixture is not
 * merely ranked below the real rows, it is the ONLY row that qualifies. A
 * filter that quietly degrades to "show something rather than nothing" when
 * the result would otherwise be empty is exactly how a synthetic trade ends
 * up in a screenshot of an empty market.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "./schema";
import { cutoffIso, excludeSynthetic, showSyntheticData } from "./trade-filters";
import type { Database } from "./client";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const iso = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

let client: PGlite;
let db: Database;

/** The env is process-global, so it is captured and put back per test. */
let savedFlag: string | undefined;

async function addCompany(ticker: string | null, name: string): Promise<string> {
  const [row] = await db
    .insert(schema.companies)
    .values({ externalKey: `ticker:US:${ticker ?? name}`, ticker, name, country: "US" })
    .returning({ id: schema.companies.id });
  return row!.id;
}

async function addTrade(companyId: string, insiderId: string, dedupKey: string): Promise<void> {
  await db.insert(schema.transactions).values({
    source: "edgar",
    insiderId,
    companyId,
    txnDate: iso(3),
    code: "P",
    shares: "1000",
    value: "100000",
    valueUsd: "100000",
    acquiredDisposed: "A",
    relevance: "opportunistic",
    dedupKey,
    country: "US",
  });
}

/**
 * The company-grouped heatmap cell query, reduced to the parts that decide
 * membership: the window and the gate. Same joins, same predicate object.
 */
async function aggregateTickers(): Promise<Array<string | null>> {
  const rows = await db
    .select({ ticker: schema.companies.ticker, trades: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.transactions)
    .innerJoin(schema.companies, eq(schema.transactions.companyId, schema.companies.id))
    .where(and(gte(schema.transactions.txnDate, cutoffIso(30)), excludeSynthetic()))
    .groupBy(schema.companies.ticker);
  return rows.map((r) => r.ticker);
}

beforeEach(async () => {
  savedFlag = process.env.INSIDERFLOW_SHOW_SYNTHETIC;
  delete process.env.INSIDERFLOW_SHOW_SYNTHETIC;

  client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Database;

  const [insider] = await db
    .insert(schema.insiders)
    .values({ externalKey: "name:US:REAL PERSON", name: "REAL PERSON" })
    .returning({ id: schema.insiders.id });

  const zz = await addCompany("ZZFIXTURE", "ZZ Fixture Co");
  await addTrade(zz, insider!.id, "zz-fixture#0");
}, 60_000);

afterEach(async () => {
  await client?.close();
  if (savedFlag === undefined) delete process.env.INSIDERFLOW_SHOW_SYNTHETIC;
  else process.env.INSIDERFLOW_SHOW_SYNTHETIC = savedFlag;
});

describe("the synthetic gate in production configuration", () => {
  it("returns nothing rather than the fixture when the fixture is all there is", async () => {
    // The adversarial state, and the only one where the filter costs
    // anything: an empty aggregate is the honest answer, and "one cell"
    // would be a fabricated picture of the market.
    expect(showSyntheticData(), "precondition: the production default").toBe(false);
    expect(await aggregateTickers()).toEqual([]);
  });

  it("drops the fixture and keeps the real company when both qualify", async () => {
    const [insider] = await db
      .insert(schema.insiders)
      .values({ externalKey: "name:US:SECOND PERSON", name: "SECOND PERSON" })
      .returning({ id: schema.insiders.id });
    const real = await addCompany("ACME", "Acme Corp");
    await addTrade(real, insider!.id, "acme#0");

    expect(await aggregateTickers()).toEqual(["ACME"]);
  });

  it("keeps a company with no ticker at all", async () => {
    // The predicate's `is null or` branch. An unlisted issuer is not a
    // fixture, and silently dropping every one of them from the aggregates
    // would be data loss wearing a safety property's clothes.
    const [insider] = await db
      .insert(schema.insiders)
      .values({ externalKey: "name:US:THIRD PERSON", name: "THIRD PERSON" })
      .returning({ id: schema.insiders.id });
    const unlisted = await addCompany(null, "Unlisted Issuer");
    await addTrade(unlisted, insider!.id, "unlisted#0");

    expect(await aggregateTickers()).toEqual([null]);
  });
});

describe("the opt-in", () => {
  it("admits the fixture when the deployment asks for it in so many words", async () => {
    process.env.INSIDERFLOW_SHOW_SYNTHETIC = "true";
    expect(showSyntheticData()).toBe(true);
    // This is the state the e2e suite runs in, where the page's obligation
    // becomes the SyntheticDataNotice instead — see
    // apps/web/e2e/seed-honesty.spec.ts.
    expect(await aggregateTickers()).toEqual(["ZZFIXTURE"]);
  });

  it("treats every other value as off, including the ones that look true", async () => {
    // The default has to be the safe one, so anything short of the exact
    // opt-in string can only ever hide data, never publish fabricated data.
    for (const value of ["1", "TRUE", "yes", "on", ""]) {
      process.env.INSIDERFLOW_SHOW_SYNTHETIC = value;
      expect(showSyntheticData(), `INSIDERFLOW_SHOW_SYNTHETIC=${value}`).toBe(false);
      expect(await aggregateTickers(), `INSIDERFLOW_SHOW_SYNTHETIC=${value}`).toEqual([]);
    }
  });
});

/**
 * The cluster preset from a COLD database.
 *
 * The existing parity test asserts that the flags path and the query-time path
 * agree — but only after cluster maintenance has run. That is the state it
 * seeds, so it could never see the state a contributor actually meets first:
 * `cluster_flags` empty, real qualifying companies in `transactions`, and the
 * screener confidently answering "none". Not a missing feature — a wrong
 * answer, with a green test beside it.
 *
 * These run the real migrations on PGlite and exercise the three states that
 * matter: cold, maintained, and maintained-but-this-company-does-not-qualify.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "./schema";
import { buildTradeConditions, clusterFallbackActive } from "./trade-filters";
import type { Database } from "./client";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const iso = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

let client: PGlite;
let db: Database;
let companyId: string;

/** Trades matching the cluster preset: two distinct insiders, code P, in window. */
async function seedClusterBuys(): Promise<void> {
  const [company] = await db
    .insert(schema.companies)
    .values({ externalKey: "ticker:US:ZZCLUSTER", ticker: "ZZCLUSTER", name: "ZZ Cluster Co" })
    .returning({ id: schema.companies.id });
  companyId = company!.id;

  const insiderIds: string[] = [];
  for (const name of ["ZZ CLUSTER ONE", "ZZ CLUSTER TWO"]) {
    const [insider] = await db
      .insert(schema.insiders)
      .values({ externalKey: `name:US:${name}`, name })
      .returning({ id: schema.insiders.id });
    insiderIds.push(insider!.id);
  }

  const rows: (typeof schema.transactions.$inferInsert)[] = insiderIds.map((insiderId, i) => ({
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
    dedupKey: `zz-cluster-${i}#0`,
    country: "US",
  }));
  await db.insert(schema.transactions).values(rows);
}

async function clusterResults(): Promise<number> {
  const conditions = buildTradeConditions(db, { cluster: true });
  const rows = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .innerJoin(schema.companies, eq(schema.transactions.companyId, schema.companies.id))
    .innerJoin(schema.insiders, eq(schema.transactions.insiderId, schema.insiders.id))
    .leftJoin(schema.filings, eq(schema.transactions.filingId, schema.filings.id))
    .where(and(...conditions));
  return rows.length;
}

beforeEach(async () => {
  client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite as unknown as Database;
  await seedClusterBuys();
}, 60_000);

afterEach(async () => {
  await client?.close();
});

describe("cluster preset from a cold database", () => {
  it("returns the qualifying trades before maintenance has ever run", async () => {
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from cluster_flags",
    );
    expect(rows[0]!.n, "precondition: no maintenance has run").toBe(0);

    // The bug: this returned 0 while the query-time definition returned these
    // exact rows, so `cluster-buys` rendered empty on a fresh stack.
    expect(await clusterResults()).toBe(2);
  });

  it("reports the fallback as active so a cold analytics job is visible", async () => {
    expect(await clusterFallbackActive(db)).toBe(true);
  });
});

describe("cluster preset once maintenance has run", () => {
  it("reads from the flags and stops falling back", async () => {
    await db.insert(schema.clusterFlags).values({
      companyId,
      direction: "buy",
      windowStart: iso(3),
      windowEnd: iso(3),
      insiderCount: 2,
      tradeCount: 2,
    });

    expect(await clusterResults()).toBe(2);
    expect(await clusterFallbackActive(db)).toBe(false);
  });

  it("excludes a company the flags do NOT cover, rather than silently re-deriving it", async () => {
    // A flag exists — for someone else. The fallback must switch off, because
    // "maintenance ran and decided this company does not qualify" is a real
    // answer and quietly overriding it would hide a stale or broken job.
    const [other] = await db
      .insert(schema.companies)
      .values({ externalKey: "ticker:US:ZZOTHER", ticker: "ZZOTHER", name: "ZZ Other Co" })
      .returning({ id: schema.companies.id });
    await db.insert(schema.clusterFlags).values({
      companyId: other!.id,
      direction: "buy",
      windowStart: iso(3),
      windowEnd: iso(3),
      insiderCount: 2,
      tradeCount: 2,
    });

    expect(await clusterResults()).toBe(0);
    expect(await clusterFallbackActive(db)).toBe(false);
  });

  it("ignores a flag whose window has aged out of the lookback", async () => {
    await db.insert(schema.clusterFlags).values({
      companyId,
      direction: "buy",
      windowStart: iso(90),
      windowEnd: iso(80),
      insiderCount: 2,
      tradeCount: 2,
    });
    // Flags are non-empty, so no fallback; the flag itself is out of window.
    expect(await clusterResults()).toBe(0);
  });
});

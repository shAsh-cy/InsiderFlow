/**
 * Analytics integration tests on PGlite (never the dev database).
 *
 * The load-bearing test here is the cluster PARITY test: precomputing a
 * signal is only safe if the precomputed answer equals the query-time answer.
 * The scoring tests drive the published formulas directly against hand-checked
 * fixtures, so "reproducible from the documented formula" is enforced rather
 * than asserted.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { beforeEach, describe, expect, it } from "vitest";

import * as dbExports from "@insiderflow/db";
import type { Database } from "@insiderflow/db";
import { sicToSector } from "@insiderflow/core";

import { activeClusters, maintainClusterFlags, recomputeClusterFlags } from "./clusters";
import { computeAnomalies } from "./anomalies";
import { scoreTrades } from "./scoring";
import {
  compositeScore,
  median,
  periodReturn,
  realizedRoundTrips,
  signedExcess,
  zScore,
} from "./scoring-math";

interface Harness {
  db: Database;
  close: () => Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  const pglite = drizzle(client, { schema: dbExports });
  const { apply } = await pushSchema(
    { ...dbExports },
    pglite as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();
  return { db: pglite as unknown as Database, close: () => client.close() };
}

const iso = (offsetDays: number): string =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

let seq = 0;

async function addCompany(h: Harness, ticker: string): Promise<string> {
  const [row] = await h.db
    .insert(dbExports.companies)
    .values({
      externalKey: `ticker:US:${ticker}`,
      ticker,
      name: `${ticker} Test Corp`,
      country: "US",
    })
    .returning({ id: dbExports.companies.id });
  return row!.id;
}

async function addInsider(h: Harness, name: string): Promise<string> {
  const [row] = await h.db
    .insert(dbExports.insiders)
    .values({ externalKey: `name:US:${name}`, name, isOfficer: true })
    .returning({ id: dbExports.insiders.id });
  return row!.id;
}

async function addTrade(
  h: Harness,
  opts: {
    companyId: string;
    insiderId: string;
    txnDate: string;
    code?: "P" | "S";
    shares?: number;
    price?: number;
    valueUsd?: number;
    relevance?: "routine" | "opportunistic";
  },
): Promise<string> {
  seq++;
  const shares = opts.shares ?? 1000;
  const price = opts.price ?? 10;
  const [row] = await h.db
    .insert(dbExports.transactions)
    .values({
      source: "edgar",
      insiderId: opts.insiderId,
      companyId: opts.companyId,
      txnDate: opts.txnDate,
      code: opts.code ?? "P",
      shares: String(shares),
      price: String(price),
      value: String(opts.valueUsd ?? shares * price),
      currency: "USD",
      priceUsd: String(price),
      valueUsd: String(opts.valueUsd ?? shares * price),
      acquiredDisposed: (opts.code ?? "P") === "P" ? "A" : "D",
      relevance: opts.relevance ?? "opportunistic",
      dedupKey: `zz-analytics-${seq}#0`,
      country: "US",
    })
    .returning({ id: dbExports.transactions.id });
  return row!.id;
}

async function addPrices(
  h: Harness,
  symbol: string,
  points: Array<{ date: string; close: number }>,
): Promise<void> {
  await h.db.insert(dbExports.dailyPrices).values(
    points.map((p) => ({
      symbol,
      market: "US",
      priceDate: p.date,
      close: String(p.close),
    })),
  );
}

describe("cluster flags", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it("matches the query-time SQL fallback on labeled fixtures", async () => {
    // LABELS — what each fixture is supposed to prove:
    //   ZZCLUSTER  cluster    2 insiders bought inside the window
    //   ZZSOLO     no cluster 1 insider bought twice (repeat ≠ cluster)
    //   ZZSTALE    no cluster 2 insiders, but both trades predate the window
    //   ZZSELL     no BUY cluster 2 insiders SOLD (wrong direction)
    const clustered = await addCompany(h, "ZZCLUSTER");
    const solo = await addCompany(h, "ZZSOLO");
    const stale = await addCompany(h, "ZZSTALE");
    const sellSide = await addCompany(h, "ZZSELL");

    const a = await addInsider(h, "ZZ INSIDER A");
    const b = await addInsider(h, "ZZ INSIDER B");

    await addTrade(h, { companyId: clustered, insiderId: a, txnDate: iso(3) });
    await addTrade(h, { companyId: clustered, insiderId: b, txnDate: iso(1) });

    await addTrade(h, { companyId: solo, insiderId: a, txnDate: iso(4) });
    await addTrade(h, { companyId: solo, insiderId: a, txnDate: iso(2) });

    await addTrade(h, { companyId: stale, insiderId: a, txnDate: iso(40) });
    await addTrade(h, { companyId: stale, insiderId: b, txnDate: iso(38) });

    await addTrade(h, { companyId: sellSide, insiderId: a, txnDate: iso(2), code: "S" });
    await addTrade(h, { companyId: sellSide, insiderId: b, txnDate: iso(1), code: "S" });

    await maintainClusterFlags(h.db);

    const fromFlags = new Set(
      (await activeClusters(h.db, { direction: "buy" })).map((c) => c.companyId),
    );
    const fromSql = new Set(
      (await h.db.select().from(dbExports.clusterCompaniesSubquery(h.db).as("s"))).map(
        (r) => (r as { companyId: string }).companyId,
      ),
    );

    expect([...fromFlags].sort()).toEqual([...fromSql].sort());
    expect(fromFlags.has(clustered)).toBe(true);
    expect(fromFlags.has(solo)).toBe(false);
    expect(fromFlags.has(stale)).toBe(false);
    expect(fromFlags.has(sellSide)).toBe(false);

    // The sell side is still detected — just under the other direction.
    const sells = await activeClusters(h.db, { direction: "sell" });
    expect(sells.map((s) => s.companyId)).toEqual([sellSide]);
  });

  it("anchors the window to the earliest qualifying trade, not to today", async () => {
    const company = await addCompany(h, "ZZANCHOR");
    const a = await addInsider(h, "ZZ ANCHOR A");
    const b = await addInsider(h, "ZZ ANCHOR B");
    await addTrade(h, { companyId: company, insiderId: a, txnDate: iso(5) });
    await addTrade(h, { companyId: company, insiderId: b, txnDate: iso(2) });

    await maintainClusterFlags(h.db);
    const [flag] = await activeClusters(h.db, { direction: "buy" });
    expect(flag!.windowStart).toBe(iso(5));
    expect(flag!.windowEnd).toBe(iso(2));
    expect(flag!.insiderCount).toBe(2);
  });

  it("is idempotent and advances the count when a third insider joins", async () => {
    const company = await addCompany(h, "ZZGROW");
    const a = await addInsider(h, "ZZ GROW A");
    const b = await addInsider(h, "ZZ GROW B");
    const c = await addInsider(h, "ZZ GROW C");
    await addTrade(h, { companyId: company, insiderId: a, txnDate: iso(5) });
    await addTrade(h, { companyId: company, insiderId: b, txnDate: iso(4) });

    await maintainClusterFlags(h.db);
    await recomputeClusterFlags(h.db, [company]); // running twice changes nothing
    let flags = await activeClusters(h.db);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.insiderCount).toBe(2);

    await addTrade(h, { companyId: company, insiderId: c, txnDate: iso(1) });
    await maintainClusterFlags(h.db);

    flags = await activeClusters(h.db);
    // Same anchor → the SAME row, updated. A second row would double-alert.
    expect(flags).toHaveLength(1);
    expect(flags[0]!.insiderCount).toBe(3);
    expect(flags[0]!.windowStart).toBe(iso(5));
  });

  it("retracts a flag once it stops being true", async () => {
    const company = await addCompany(h, "ZZRETRACT");
    const a = await addInsider(h, "ZZ RETRACT A");
    const b = await addInsider(h, "ZZ RETRACT B");
    const first = await addTrade(h, { companyId: company, insiderId: a, txnDate: iso(4) });
    await addTrade(h, { companyId: company, insiderId: b, txnDate: iso(2) });

    await maintainClusterFlags(h.db);
    expect(await activeClusters(h.db, { direction: "buy" })).toHaveLength(1);

    // One of the two trades goes away (a purge, or an amendment superseding
    // it). One insider is not a cluster, so the flag must not survive — an
    // upsert-only recompute would have left it standing for another 14 days.
    await h.db.delete(dbExports.transactions).where(dbExports.eq(dbExports.transactions.id, first));
    await recomputeClusterFlags(h.db, [company]);

    expect(await activeClusters(h.db, { direction: "buy" })).toHaveLength(0);
  });

  it("keeps settled history outside the lookback window", async () => {
    const company = await addCompany(h, "ZZHISTORY");
    const a = await addInsider(h, "ZZ HISTORY A");
    const b = await addInsider(h, "ZZ HISTORY B");

    // A genuine cluster from two months ago, already written.
    await h.db.insert(dbExports.clusterFlags).values({
      companyId: company,
      direction: "buy",
      windowStart: iso(60),
      windowEnd: iso(55),
      insiderCount: 4,
      tradeCount: 6,
      totalUsd: "2000000",
    });
    // Fresh, unrelated activity triggers a recompute of the same company.
    await addTrade(h, { companyId: company, insiderId: a, txnDate: iso(3) });
    await addTrade(h, { companyId: company, insiderId: b, txnDate: iso(1) });
    await maintainClusterFlags(h.db);

    const all = await h.db.select().from(dbExports.clusterFlags);
    // Retraction is scoped to the lookback: the old window is history, not a
    // live claim, and the stock-page timeline still needs it.
    expect(all).toHaveLength(2);
    expect(all.some((f) => f.windowStart === iso(60))).toBe(true);
  });

  it("only recomputes companies touched since the cursor", async () => {
    const company = await addCompany(h, "ZZCURSOR");
    const a = await addInsider(h, "ZZ CURSOR A");
    const b = await addInsider(h, "ZZ CURSOR B");
    await addTrade(h, { companyId: company, insiderId: a, txnDate: iso(3) });
    await addTrade(h, { companyId: company, insiderId: b, txnDate: iso(2) });

    const first = await maintainClusterFlags(h.db);
    expect(first.companiesConsidered).toBe(1);
    expect(first.cursorAdvanced).toBe(true);

    const second = await maintainClusterFlags(h.db);
    expect(second.companiesConsidered).toBe(0);
    expect(second.cursorAdvanced).toBe(false);
  });
});

describe("scoring", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it("reproduces the documented formulas end to end", async () => {
    const company = await addCompany(h, "ZZSCORE");
    const insider = await addInsider(h, "ZZ SCORER");
    const txnDate = iso(200);

    // Stock +20% over 90 days, benchmark +5% → signed excess for a BUY = +15%.
    await addPrices(h, "ZZSCORE", [
      { date: txnDate, close: 100 },
      { date: iso(170), close: 110 },
      { date: iso(110), close: 120 },
      { date: iso(20), close: 130 },
    ]);
    await addPrices(h, "SPY", [
      { date: txnDate, close: 400 },
      { date: iso(170), close: 408 },
      { date: iso(110), close: 420 },
      { date: iso(20), close: 440 },
    ]);

    await addTrade(h, { companyId: company, insiderId: insider, txnDate, code: "P", price: 100 });

    const result = await scoreTrades({ db: h.db });
    expect(result.tradesScored).toBe(1);

    const [row] = await h.db.select().from(dbExports.tradeReturns);
    // (120 − 100) / 100 = 0.20
    expect(Number(row!.ret90d)).toBeCloseTo(0.2, 6);
    // (420 − 400) / 400 = 0.05
    expect(Number(row!.bench90d)).toBeCloseTo(0.05, 6);
    expect(Number(row!.excess90d)).toBeCloseTo(0.15, 6);

    const [score] = await h.db.select().from(dbExports.insiderScores);
    expect(score!.scoredTrades).toBe(1);
    expect(score!.wins90d).toBe(1);
    // Shrinkage: 0.15 × 1/(1+5) × 100 = 2.5
    expect(Number(score!.score)).toBeCloseTo(2.5, 4);
  });

  it("scores a well-timed sale as a win, not a loss", async () => {
    const company = await addCompany(h, "ZZSELLWIN");
    const insider = await addInsider(h, "ZZ SELLER");
    const txnDate = iso(200);

    // Stock falls 10% while the benchmark is flat: selling was right.
    await addPrices(h, "ZZSELLWIN", [
      { date: txnDate, close: 100 },
      { date: iso(110), close: 90 },
    ]);
    await addPrices(h, "SPY", [
      { date: txnDate, close: 400 },
      { date: iso(110), close: 400 },
    ]);
    await addTrade(h, { companyId: company, insiderId: insider, txnDate, code: "S", price: 100 });

    await scoreTrades({ db: h.db });
    const [row] = await h.db.select().from(dbExports.tradeReturns);
    expect(Number(row!.ret90d)).toBeCloseTo(-0.1, 6);
    expect(Number(row!.excess90d)).toBeCloseTo(0.1, 6); // signed by direction
  });

  it("excludes routine and superseded rows", async () => {
    const company = await addCompany(h, "ZZEXCL");
    const insider = await addInsider(h, "ZZ EXCLUDED");
    const txnDate = iso(200);
    await addPrices(h, "ZZEXCL", [
      { date: txnDate, close: 100 },
      { date: iso(110), close: 120 },
    ]);
    await addPrices(h, "SPY", [
      { date: txnDate, close: 400 },
      { date: iso(110), close: 410 },
    ]);

    // Routine compensation plumbing is not a decision.
    await addTrade(h, {
      companyId: company,
      insiderId: insider,
      txnDate,
      relevance: "routine",
    });

    // Superseded by an amendment — replaced, so it never happened as filed.
    const [amendment] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-score-amend",
        formType: "4/A",
        filedAt: new Date(),
        issuerCompanyId: company,
      })
      .returning({ id: dbExports.filings.id });
    const [original] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-score-orig",
        formType: "4",
        filedAt: new Date(),
        issuerCompanyId: company,
        supersededByFilingId: amendment!.id,
      })
      .returning({ id: dbExports.filings.id });
    seq++;
    await h.db.insert(dbExports.transactions).values({
      source: "edgar",
      filingId: original!.id,
      insiderId: insider,
      companyId: company,
      txnDate,
      code: "P",
      shares: "100",
      price: "100",
      value: "10000",
      currency: "USD",
      valueUsd: "10000",
      acquiredDisposed: "A",
      relevance: "opportunistic",
      dedupKey: `zz-superseded-score-${seq}#0`,
      country: "US",
    });

    const result = await scoreTrades({ db: h.db });
    expect(result.tradesConsidered).toBe(0);
    expect(result.tradesScored).toBe(0);
  });

  it("leaves a horizon null when the price data does not reach it", async () => {
    const company = await addCompany(h, "ZZSHORT");
    const insider = await addInsider(h, "ZZ SHORT");
    const txnDate = iso(200);
    // Only a +30d point exists; 90d and 180d must stay null, never 0.
    await addPrices(h, "ZZSHORT", [
      { date: txnDate, close: 100 },
      { date: iso(170), close: 105 },
    ]);
    await addPrices(h, "SPY", [
      { date: txnDate, close: 400 },
      { date: iso(170), close: 404 },
    ]);
    await addTrade(h, { companyId: company, insiderId: insider, txnDate, price: 100 });

    await scoreTrades({ db: h.db });
    const [row] = await h.db.select().from(dbExports.tradeReturns);
    expect(Number(row!.excess30d)).toBeCloseTo(0.04, 6);
    expect(row!.excess90d).toBeNull();
    expect(row!.excess180d).toBeNull();
  });
});

describe("anomalies", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it("suppresses the z-score until the baseline is deep enough", async () => {
    const company = await addCompany(h, "ZZTHIN");
    const insider = await addInsider(h, "ZZ THIN");
    await addTrade(h, { companyId: company, insiderId: insider, txnDate: iso(5) });

    const result = await computeAnomalies({ db: h.db });
    expect(result.suppressed).toBe(1);
    expect(result.published).toBe(0);

    const [row] = await h.db.select().from(dbExports.companyAnomalies);
    expect(row!.zScore).toBeNull();
    expect(Number(row!.netUsd)).toBeGreaterThan(0);
  });

  it("suppresses a baseline with no dispersion", async () => {
    const company = await addCompany(h, "ZZFLAT");
    const insider = await addInsider(h, "ZZ FLAT");
    // An identical figure every month gives stddev 0 — dividing by it would
    // report infinite significance for a one-dollar move.
    for (let w = 1; w <= 12; w++) {
      await addTrade(h, {
        companyId: company,
        insiderId: insider,
        txnDate: iso(w * 30 + 5),
        valueUsd: 10_000,
      });
    }
    await addTrade(h, {
      companyId: company,
      insiderId: insider,
      txnDate: iso(3),
      valueUsd: 11_000,
    });

    const result = await computeAnomalies({ db: h.db });
    expect(result.published).toBe(0);
    expect(result.suppressed).toBe(1);
  });

  it("scores a spike against the company's own quiet history", async () => {
    const company = await addCompany(h, "ZZSPIKE");
    const insider = await addInsider(h, "ZZ SPIKE");

    // Twelve quiet months around $10k (with ordinary variation, so the
    // baseline has real dispersion), then $5M this month.
    for (let w = 1; w <= 12; w++) {
      await addTrade(h, {
        companyId: company,
        insiderId: insider,
        txnDate: iso(w * 30 + 5),
        valueUsd: 10_000 + w * 500,
      });
    }
    await addTrade(h, {
      companyId: company,
      insiderId: insider,
      txnDate: iso(3),
      valueUsd: 5_000_000,
    });

    const result = await computeAnomalies({ db: h.db });
    expect(result.published).toBe(1);

    const [row] = await h.db.select().from(dbExports.companyAnomalies);
    expect(Number(row!.zScore)).toBeGreaterThan(3);
    expect(row!.sampleSize).toBe(12);
  });
});

describe("published formulas", () => {
  it("periodReturn and signedExcess behave as documented", () => {
    expect(periodReturn(100, 120)).toBeCloseTo(0.2, 10);
    expect(periodReturn(0, 120)).toBeNull();
    expect(signedExcess(0.2, 0.05, "buy")).toBeCloseTo(0.15, 10);
    expect(signedExcess(-0.2, 0.05, "sell")).toBeCloseTo(0.25, 10);
    expect(signedExcess(null, 0.05, "buy")).toBeNull();
  });

  it("compositeScore shrinks small samples toward zero", () => {
    const one = compositeScore([0.5]);
    const many = compositeScore(Array.from({ length: 45 }, () => 0.5));
    expect(one).toBeCloseTo(((0.5 * 1) / 6) * 100, 6);
    expect(many).toBeCloseTo(((0.5 * 45) / 50) * 100, 6);
    expect(many!).toBeGreaterThan(one!);
  });

  it("median and zScore guard thin samples", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(zScore(10, [1, 2, 3])).toBeNull(); // below MIN_SAMPLE
    expect(zScore(10, [0, 0, 0, 0, 0, 0])).toBeNull(); // no dispersion
    const stats = zScore(10, [1, 2, 3, 4, 5, 6])!;
    expect(stats.mean).toBeCloseTo(3.5, 10);
    expect(stats.z).toBeGreaterThan(3);
  });

  it("matches sales to buys FIFO and skips unmatched sales", () => {
    const result = realizedRoundTrips([
      { shares: 100, price: 10, date: "2026-01-01" },
      { shares: 100, price: 20, date: "2026-02-01" },
      { shares: -100, price: 30, date: "2026-03-01" },
    ]);
    // FIFO closes the $10 lot first: (30 − 10) / 10 = +200%.
    expect(result.trades).toBe(1);
    expect(result.returnPct).toBeCloseTo(2, 6);

    // A sale we never saw the purchase for is skipped, not treated as free stock.
    const orphanSale = realizedRoundTrips([{ shares: -100, price: 30, date: "2026-03-01" }]);
    expect(orphanSale.trades).toBe(0);
    expect(orphanSale.returnPct).toBeNull();
  });

  it("maps SIC codes into sectors, and refuses to guess", () => {
    expect(sicToSector("7372")).toBe("Technology"); // prepackaged software
    expect(sicToSector("2834")).toBe("Health Care"); // pharmaceutical preparations
    expect(sicToSector(6022)).toBe("Financials"); // state commercial banks
    expect(sicToSector("1311")).toBe("Energy"); // crude petroleum
    expect(sicToSector("6798")).toBe("Real Estate"); // REITs
    expect(sicToSector("4911")).toBe("Utilities");
    expect(sicToSector(null)).toBeNull();
    expect(sicToSector("")).toBeNull();
    expect(sicToSector("0000")).toBeNull();
  });
});

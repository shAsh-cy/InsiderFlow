/**
 * The synthetic gate, as the heatmap actually composes it.
 *
 * ── WHAT THIS IS REALLY MEASURING ─────────────────────────────────────
 *
 * `packages/db/src/synthetic-scope.test.ts` proves that `excludeSynthetic()`
 * filters. It proves it against a query the test itself builds — same joins,
 * same predicate object, but assembled in the test file. So it answers "does
 * the predicate work" and cannot answer "does the heatmap use it", and those
 * are different claims: deleting `excludeSynthetic()` from the `conds` array
 * in `queryHeatmap` leaves that test, and every other test in the repo,
 * green. Nothing calls `queryHeatmap`.
 *
 * Nor can the e2e suite: `showSyntheticData()` reads the environment at call
 * time, the running build was started with `INSIDERFLOW_SHOW_SYNTHETIC=true`,
 * and no HTTP request can change that. The one configuration that ships —
 * the switch OFF — is unreachable over the wire.
 *
 * In-process it is reachable, because the env var belongs to THIS process.
 * So this file calls the real `queryHeatmap` from the working tree, against
 * the real database the running build is pointed at, with the flag under the
 * test's control. That is the whole gap: the function both `/heatmap` and
 * `/api/heatmap` call, on the configuration production runs.
 *
 * ── THE INDEPENDENT SIDE ──────────────────────────────────────────────
 *
 * Membership is decided by hand-written SQL below — not by `excludeSynthetic`,
 * not by `cutoffIso`. Asking the gate which rows the gate should have removed
 * would put the same wrong answer on both sides of the comparison.
 *
 * ── CONCURRENCY ───────────────────────────────────────────────────────
 *
 * Other spec files create and drop ZZ* fixtures against this same database
 * while this runs, so a set read once and compared later can differ for
 * reasons that are not defects. Every assertion here is therefore written
 * over a quantity that concurrent fixture churn cannot move: the non-ZZ rows
 * (no fixture anywhere creates one), or the set present in a ground-truth
 * read taken on BOTH sides of the call.
 *
 *   cd apps/web && npx vitest run integration/heatmap-synthetic.test.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDbHandle, sql } from "@insiderflow/db";
import type { Database, DatabaseHandle } from "@insiderflow/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { queryHeatmap } from "../src/lib/api/queries";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The app's own connection string; never logged — a failing test prints its arguments. */
function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const raw = readFileSync(resolve(appDir, ".env.local"), "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) {
    throw new Error("No DATABASE_URL in apps/web/.env.local and none in the environment");
  }
  return line
    .slice("DATABASE_URL=".length)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * The 30-day window, recomputed rather than imported from `cutoffIso`.
 *
 * Importing it would make the two sides agree about the window by
 * construction, and a drifted lookback is exactly the kind of difference the
 * hand-written side exists to notice. UTC, because the app derives its cutoff
 * in Node from `toISOString()` rather than from Postgres's `current_date`.
 */
const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

/** The query under test, as `/api/heatmap?group_by=company&timeframe=30d` builds it. */
const COMPANY_QUERY = { days: 30, group_by: "company", limit: 200 } as const;

let handle: DatabaseHandle;
let db: Database;
let savedFlag: string | undefined;

beforeAll(async () => {
  handle = createDbHandle(databaseUrl());
  db = handle.db;
  // Once, legibly, rather than as a connection error dressed up as a
  // fabricated row appearing in an aggregate.
  await db.execute(sql`select 1`);
});

afterAll(async () => {
  await handle?.end();
});

// The flag is process-global and the running server is a different process,
// so this moves nothing under anyone else — but it must be put back, because
// vitest shares the process across files.
beforeEach(() => {
  savedFlag = process.env.INSIDERFLOW_SHOW_SYNTHETIC;
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.INSIDERFLOW_SHOW_SYNTHETIC;
  else process.env.INSIDERFLOW_SHOW_SYNTHETIC = savedFlag;
});

/** Tickers with at least one transaction in the window, split on the reserved namespace. */
async function groundTruth(): Promise<{ synthetic: string[]; real: string[] }> {
  const rows = await db.execute<{ ticker: string | null }>(sql`
    select distinct c.ticker as ticker
      from transactions t
      join companies c on c.id = t.company_id
     where t.txn_date >= ${cutoff}::date`);
  const all = [...rows].map((r) => r.ticker);
  return {
    synthetic: all.filter((t): t is string => t !== null && t.startsWith("ZZ")),
    // A null ticker is an unlisted issuer, not a fixture: it belongs on the
    // real side, and `queryHeatmap` keys those cells by company id.
    real: all.filter((t) => t === null || !t.startsWith("ZZ")).map((t) => t ?? "(unlisted)"),
  };
}

describe("queryHeatmap in production configuration", () => {
  it("excludes the fixtures it is holding, and keeps everything else", async () => {
    delete process.env.INSIDERFLOW_SHOW_SYNTHETIC;

    const truth = await groundTruth();
    // The exclusion is only worth testing where it costs something. If the
    // window held no fixtures, an empty ZZ* result would be the window's
    // doing and this file would be asserting nothing.
    expect(
      truth.synthetic.length,
      "precondition: the window must contain fixtures for the gate to have work to do",
    ).toBeGreaterThan(0);

    const cells = await queryHeatmap(db, COMPANY_QUERY);

    // Race-free by construction: no fixture helper anywhere creates a non-ZZ
    // company, so the real side cannot move under a concurrent spec run.
    expect(cells.filter((c) => c.ticker !== null && c.ticker.startsWith("ZZ"))).toEqual([]);
    expect(cells).toHaveLength(truth.real.length);

    // Which, on a stack seeded with nothing but fixtures, means the honest
    // answer is an empty market — not the one cell that would make a
    // screenshot of fabricated data look like a picture of the tape.
    if (truth.real.length === 0) expect(cells).toEqual([]);
  });

  it("still counts them when the deployment opts in, or the line above proves nothing", async () => {
    // The non-vacuity control. Without it, a `queryHeatmap` that threw its
    // rows away, or read the wrong window, or was handed a database with no
    // transactions in it at all, would pass the exclusion test above.
    const before = await groundTruth();
    process.env.INSIDERFLOW_SHOW_SYNTHETIC = "true";
    const cells = await queryHeatmap(db, COMPANY_QUERY);
    const after = await groundTruth();

    const returned = new Set(cells.map((c) => c.ticker));
    // Present in a read on either side of the call is the strongest claim
    // that survives another worker inserting or cleaning up mid-test.
    const throughout = before.synthetic.filter((t) => after.synthetic.includes(t));
    expect(throughout.length).toBeGreaterThan(0);
    for (const ticker of throughout) {
      expect(returned.has(ticker), `${ticker} qualifies and the opt-in was given`).toBe(true);
    }
  });

  it("keeps fabricated money out of a real sector's total", async () => {
    // The sector view is where an unfiltered fixture does its quietest
    // damage: it does not appear as a ZZ* label anybody could notice, it is
    // silently added to "Technology". Asserted on the SUM, because that is
    // the number a reader of the chart actually takes away.
    delete process.env.INSIDERFLOW_SHOW_SYNTHETIC;
    const gated = await queryHeatmap(db, { days: 30, group_by: "sector", limit: 200 });

    const [row] = [
      ...(await db.execute<{ trades: number; value: string }>(sql`
        select count(*)::int as trades,
               coalesce(sum(t.value_usd), 0)::text as value
          from transactions t
          join companies c on c.id = t.company_id
         where t.txn_date >= ${cutoff}::date
           and (c.ticker is null or c.ticker not like 'ZZ%')`)),
    ];

    expect(gated.reduce((n, c) => n + c.trades, 0)).toBe(row!.trades);
    expect(gated.reduce((n, c) => n + c.buyValueUsd + c.sellValueUsd, 0)).toBe(Number(row!.value));
  });
});

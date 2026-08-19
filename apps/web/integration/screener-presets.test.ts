/**
 * Screener presets vs. SQL ground truth.
 *
 * ── WHAT THIS IS REALLY MEASURING ─────────────────────────────────────
 *
 * A preset is a promise about a row set: "purchases worth $250k+", "companies
 * where two insiders bought in a fortnight". Every existing test of that
 * promise asks `buildTradeConditions` what it thinks the answer is and then
 * checks the answer against `buildTradeConditions`. That proves the builder is
 * deterministic. It cannot notice a preset whose params say one thing and
 * whose description says another, a threshold that drifted, a filter that
 * stopped being applied, or a precomputed analytics table that has fallen out
 * of step with the transactions it was derived from — because the wrong answer
 * would appear identically on both sides of the comparison.
 *
 * So the right-hand side here is hand-written SQL. Not generated from
 * `preset.params`, not routed through the builder, not sharing the builder's
 * date arithmetic: a separate transcription of what each preset claims, in the
 * language of the tables. When the two disagree, exactly one of them is a bug,
 * and the test tells you which preset to look at.
 *
 * ── THE THREE LEGS ────────────────────────────────────────────────────
 *
 * Each case compares three answers to the same question:
 *
 *   ground truth  — hand-written SQL below. The claim.
 *   API           — a real HTTP GET against the running build. What ships.
 *   builder       — `queryTrades` in-process, from the working tree.
 *
 * All three must agree. Two legs rather than one because the failures are
 * different and a single leg hides which you have: API ≠ builder means the
 * deployed artefact is not the working tree, while API = builder ≠ SQL means
 * both are confidently wrong together, which is the failure this file exists
 * for.
 *
 * ── WHAT THE CURRENT SEED CANNOT REACH ────────────────────────────────
 *
 * Named here rather than left to be assumed, because a green run says
 * "agreed", not "exercised". Two of these are enforced further down rather
 * than merely written here, so the day the seed changes, the claim gets
 * re-read instead of quietly rotting:
 *
 *   · `relevance = 'opportunistic'` is not under load in `big-buys`,
 *     `exec-buys` or `big-discretionary-sales`. Every seeded row that clears
 *     those presets' other clauses is already opportunistic, so deleting the
 *     relevance filter outright changes none of the three row sets. Only
 *     `unusual-flow` (19 rows of 21) can tell the difference. Enforced by
 *     "names every clause the seed cannot put under load".
 *   · `dip-buys` is a 5%-below-close screen, but no seeded purchase is priced
 *     between 95% and 100% of its close, so a 5% threshold and a 0% one select
 *     the same 11 rows. The `exists`/price-context half IS under load (11 of
 *     the 12 purchases with a matching price row). The margin is not.
 *     Enforced by "cannot yet separate a 5% dip from any dip".
 *   · The superseded-filings clause is in BASE and in the builder, so it is
 *     asserted on both sides — but no fixture transaction is attached to a
 *     filing at all, so the clause selects nothing and excludes nothing.
 *     Inverting `include_superseded` would not be noticed here today.
 *   · `unusual-flow` gates on sample_size ≥ 6 as well as |z| ≥ 2, and every
 *     seeded anomaly has sample_size 12. Only the z half of that gate is
 *     under load; the fixture does prove `abs()` matters, via a −2.07.
 *   · Only the first page is compared. Offset paging, the `sort`/`order`
 *     params, and user filters composed onto a preset are all out of scope.
 *
 * ── WHY IT LIVES OUTSIDE src/ ─────────────────────────────────────────
 *
 * `pnpm test` runs `vitest run src` and CI has neither a database nor a
 * server. A test that needs both must not be able to turn a clean CI run red
 * for reasons that have nothing to do with the diff, and — worse — must not
 * teach anyone to make it skip. It sits in `integration/`, out of that glob,
 * and hard-fails when its stack is missing rather than skipping quietly:
 *
 *   cd apps/web && npx vitest run integration/screener-presets.test.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDbHandle, sql } from "@insiderflow/db";
import type { Database, DatabaseHandle } from "@insiderflow/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { queryTrades } from "../src/lib/api/queries";
import { SCREENER_PRESETS, tradesQuerySchema } from "../src/lib/api/schemas";

type RawSql = ReturnType<typeof sql>;

/** The schema's own ceiling. Asking for less would compare a fraction of the answer. */
const PAGE = 100;

const BASE_URL =
  process.env.SCREENER_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The app's own connection string.
 *
 * Read out of `.env.local` because that is the file the running server was
 * started from — a test pointed at a different database would compare two
 * unrelated row sets and call the difference a bug. Never logged, never put in
 * an assertion message: it is a live credential, and a failing test prints its
 * arguments.
 */
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
 * The 14-day cluster window, recomputed here rather than imported from
 * `cutoffIso`.
 *
 * Importing it would make the window agree by construction, which is the one
 * thing this file must not do — an off-by-one in the lookback is precisely the
 * kind of drift the ground truth is here to catch. UTC, not Postgres's
 * `current_date`, because the app computes the cutoff in Node from
 * `toISOString()`; using the server's local date would make the test fail on
 * any deployment whose database is not UTC, which is an environment
 * difference, not a defect.
 */
const clusterCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

/**
 * One labelled clause per thing a preset claims.
 *
 * Split rather than written as one predicate so the suite can ask a question
 * equality cannot: is this clause doing any work on this data? Dropping a
 * clause and re-counting is the only way to tell an asserted filter from a
 * decorative one, and three of them turn out to be decorative here (see the
 * header, and the case that enforces it).
 *
 * Thresholds are literals on purpose. Deriving them from `preset.params` would
 * re-couple the two sides and make a changed threshold invisible; written out,
 * a change to a published screen has to be made twice, deliberately, and shows
 * up in review as a change to what the product promises.
 *
 * One entry — `unusual-flow` — is weaker than the rest, and says so where it
 * is defined along with what it leaves uncovered.
 */
interface Clause {
  /** Stable name. Used as the key of the coverage ledger, so do not reword casually. */
  label: string;
  sql: RawSql;
}

const GROUND_TRUTH: Record<string, Clause[]> = {
  // No filter of its own — `latest` is the superseded-filings rule in BASE and
  // nothing else. Its value here is as the denominator every other preset is
  // asserted to be a proper subset of.
  latest: [],

  "big-buys": [
    { label: "code", sql: sql`t.code = 'P'` },
    { label: "relevance", sql: sql`t.relevance = 'opportunistic'` },
    { label: "min_value_usd", sql: sql`t.value_usd >= 250000` },
  ],

  "cluster-buys": [
    { label: "code", sql: sql`t.code = 'P'` },
    // Fully independent: derived from `transactions`, never from
    // `cluster_flags`. That is deliberate — the API answers this preset from
    // the precomputed flags, so a flag set that has gone stale, been written
    // with the wrong window anchor, or been left behind by a company whose
    // trades were deleted shows up here as a disagreement rather than as a
    // plausible-looking screen.
    {
      label: "cluster",
      sql: sql`t.company_id in (
      select p.company_id
        from transactions p
       where p.code = 'P'
         and p.txn_date >= ${clusterCutoff}::date
       group by p.company_id
      having count(distinct p.insider_id) >= 2)`,
    },
  ],

  "exec-buys": [
    { label: "code", sql: sql`t.code = 'P'` },
    { label: "relevance", sql: sql`t.relevance = 'opportunistic'` },
    { label: "exec_only", sql: sql`i.is_officer` },
  ],

  "dip-buys": [
    { label: "code", sql: sql`t.code = 'P'` },
    // 5% below the close, per `dipCondition`. The preset's user-facing
    // description says only "below that day's market close", which is the
    // looser claim; the tighter one is what the code promises. Transcribed at
    // 5% — though on this seed the two thresholds cannot be told apart, which
    // is asserted rather than assumed further down.
    {
      label: "dip",
      sql: sql`exists (
      select 1 from daily_prices dp
       where dp.symbol = c.ticker
         and dp.market = t.country
         and dp.price_date = t.txn_date
         and t.price <= dp.close * 0.95)`,
    },
  ],

  "big-discretionary-sales": [
    { label: "code", sql: sql`t.code = 'S'` },
    { label: "relevance", sql: sql`t.relevance = 'opportunistic'` },
    { label: "min_value_usd", sql: sql`t.value_usd >= 1000000` },
  ],

  "unusual-flow": [
    { label: "relevance", sql: sql`t.relevance = 'opportunistic'` },
    // WEAKER, AND NOT INDEPENDENT OF THE ANALYTICS TABLE. A z-score is a
    // statement about a company's own trailing baseline, computed by
    // packages/analytics and stored in `company_anomalies`; there is no way to
    // restate it in one query without reimplementing the estimator, at which
    // point the "independent" side would be a second, unreviewed copy of the
    // thing it is checking.
    //
    // So this asserts the property that IS checkable from here: that the API
    // applies the published gate — |z| ≥ 2, sample_size ≥ 6 — to exactly the
    // rows in that table, and to no others. NOT covered: that the z-scores are
    // correctly derived from transactions. A wrong number in
    // `company_anomalies` passes this file and is caught, if at all, in
    // packages/analytics.
    {
      label: "min_anomaly_z",
      sql: sql`exists (
      select 1 from company_anomalies ca
       where ca.company_id = t.company_id
         and ca.sample_size >= 6
         and abs(ca.z_score) >= 2)`,
    },
  ],
};

/**
 * Clauses the seed cannot put under load, as measured — not as guessed.
 *
 * A preset case going green means "the API agrees with the ground truth on
 * THIS data". It does not mean every clause was tested: where all four rows
 * clearing `code = 'P' and value_usd >= 250000` happen to be opportunistic,
 * deleting `relevance` from the screen changes nothing and the case stays
 * green. That is a fact about the fixture, so it is written down and enforced
 * rather than left for the next person to rediscover by shipping a bug.
 *
 * Shrinking this set is progress and the enforcing case will tell you to do
 * it. Growing it means coverage was lost, and the same case goes red.
 */
const UNEXERCISED_BY_THE_SEED = [
  "big-buys/relevance",
  "big-discretionary-sales/relevance",
  "exec-buys/relevance",
];

let handle: DatabaseHandle;
let db: Database;

beforeAll(async () => {
  handle = createDbHandle(databaseUrl());
  db = handle.db;
  // Fail here, once, with a legible reason — rather than seven times with a
  // connection error dressed up as a preset mismatch.
  await db.execute(sql`select 1`);
  const probe = await fetch(`${BASE_URL}/api/screener/latest?limit=1`);
  if (probe.status !== 200) {
    throw new Error(`No screener API at ${BASE_URL} (status ${probe.status}). Start the build.`);
  }
});

afterAll(async () => {
  await handle?.end();
});

/**
 * The joins and the one rule that applies to every screen.
 *
 * Single-sourced so the id query and the count query cannot drift apart and
 * start answering slightly different questions.
 */
const BASE_FROM = sql`
    from transactions t
    join companies c on c.id = t.company_id
    join insiders i on i.id = t.insider_id
    left join filings f on f.id = t.filing_id
   where (t.filing_id is null or f.superseded_by_filing_id is null)`;

/** A preset's clauses, ANDed. No clauses — `latest` — is the whole tape. */
function predicate(clauses: Clause[]): RawSql {
  return clauses.reduce<RawSql>((acc, c) => sql`(${acc}) and (${c.sql})`, sql`true`);
}

/**
 * The independent answer: ids only, ordered exactly as the API orders a page.
 *
 * The ORDER BY mirrors `queryTrades`' default (txn_date desc, then created_at,
 * then id) because the API returns a PAGE, not a set — comparing the first 100
 * of two differently-ordered sequences would report a paging difference as a
 * filtering bug. The third key is the primary key, so the order is total and
 * the comparison cannot flake on a tie.
 */
async function groundTruthIds(where: RawSql): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select t.id::text as id ${BASE_FROM}
       and (${where})
     order by t.txn_date desc, t.created_at desc, t.id desc
     limit ${PAGE}
  `);
  return [...rows].map((r) => r.id);
}

/**
 * Unpaged count. Used where the question is "how big is this set", which a
 * capped page cannot answer once a set outgrows the cap.
 */
async function groundTruthCount(where: RawSql): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n ${BASE_FROM} and (${where})
  `);
  return [...rows][0]?.n ?? -1;
}

/** What ships: a real request against the running production build. */
async function apiIds(preset: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/api/screener/${preset}?limit=${PAGE}`);
  expect(res.status, `GET /api/screener/${preset}`).toBe(200);
  const body = (await res.json()) as {
    data: { id: string }[];
    meta: { preset: string; count: number };
  };
  // A typo in the route's params plumbing could serve a different preset's
  // rows under this name; the envelope says which one it thinks it answered.
  expect(body.meta.preset).toBe(preset);
  return body.data.map((r) => r.id);
}

/** The working tree's answer, so source drift is visible without a rebuild. */
async function builderIds(preset: string): Promise<string[]> {
  const definition = SCREENER_PRESETS[preset];
  if (!definition) throw new Error(`Unknown preset ${preset}`);
  const base = tradesQuerySchema.parse({ limit: String(PAGE) });
  const result = await queryTrades(db, { ...base, ...definition.params });
  return result.data.map((r) => r.id);
}

function clausesFor(preset: string): Clause[] {
  const clauses = GROUND_TRUTH[preset];
  if (!clauses) throw new Error(`No ground-truth SQL for preset "${preset}"`);
  return clauses;
}

describe("screener presets against SQL ground truth", () => {
  it("has a hand-written query for every preset the API serves", () => {
    // A new preset is a new promise. Shipping one without restating it in SQL
    // would leave it covered by nothing while the suite stayed green.
    expect(Object.keys(GROUND_TRUTH).sort()).toEqual(Object.keys(SCREENER_PRESETS).sort());
  });

  describe.each(Object.keys(SCREENER_PRESETS))("%s", (preset) => {
    it("returns exactly the rows the independent query returns", async () => {
      const where = predicate(clausesFor(preset));

      // Bracket the two readings of the app. Other agents run against this
      // same database; if a row lands mid-case, the two sides are answers to
      // different questions and the mismatch means nothing. Comparing the
      // ground truth to itself distinguishes "the data moved" from "the API
      // is wrong" instead of letting one be reported as the other.
      const before = await groundTruthIds(where);
      const fromApi = await apiIds(preset);
      const fromBuilder = await builderIds(preset);
      const after = await groundTruthIds(where);
      expect(after, "the underlying rows changed mid-test; re-run").toEqual(before);

      // An empty preset makes every comparison below vacuously true. This is
      // the assertion that keeps the file honest against a seed that drifts.
      expect(before.length, `preset "${preset}" matched no rows`).toBeGreaterThan(0);

      // The claim the item asks for: the row-id SETS are equal.
      expect([...fromApi].sort()).toEqual([...before].sort());
      // And the stronger one, which the shared ORDER BY makes checkable: the
      // page is the same page, in the same order.
      expect(fromApi).toEqual(before);
      expect(fromBuilder).toEqual(before);
    });
  });

  it("every preset actually narrows the tape", async () => {
    // A screen that returns the whole tape is not a screen. `latest` is
    // exempt: it IS the whole tape.
    //
    // All three legs are counted, not just the ground truth. Checking only the
    // hand-written side would make this a statement about the fixture — it
    // would stay green with every filter stripped out of `buildTradeConditions`,
    // which is exactly the regression it is supposed to be watching for.
    const tape = await groundTruthCount(sql`true`);
    for (const preset of Object.keys(SCREENER_PRESETS)) {
      if (preset === "latest") continue;
      const claimed = await groundTruthCount(predicate(clausesFor(preset)));
      expect(claimed, `ground truth for "${preset}" selects the entire tape`).toBeLessThan(tape);

      const served = await apiIds(preset);
      expect(served.length, `the API serves the entire tape for "${preset}"`).toBeLessThan(tape);

      const built = await builderIds(preset);
      expect(built.length, `the builder returns the entire tape for "${preset}"`).toBeLessThan(
        tape,
      );
    }
  });

  it("names every clause the seed cannot put under load", async () => {
    // Drop one clause at a time and re-count. A clause whose removal changes
    // nothing was never tested by the equality cases above, however green they
    // look — the product could stop applying it entirely and this file would
    // not notice. The ledger of those clauses is checked exactly, in both
    // directions, so neither losing coverage nor gaining it can happen in
    // silence.
    const idle: string[] = [];
    for (const [preset, clauses] of Object.entries(GROUND_TRUTH)) {
      const full = await groundTruthCount(predicate(clauses));
      for (const clause of clauses) {
        const without = await groundTruthCount(
          predicate(clauses.filter((c) => c.label !== clause.label)),
        );
        if (without === full) idle.push(`${preset}/${clause.label}`);
      }
    }
    expect(
      idle.sort(),
      "the fixture's discriminating power changed — re-read the coverage claim in the header",
    ).toEqual([...UNEXERCISED_BY_THE_SEED].sort());
  });

  it("cannot yet separate a 5% dip from any dip", async () => {
    // The one gap the clause ledger is too coarse to see: `dip-buys` is
    // transcribed at `close * 0.95`, but no seeded purchase sits between 95%
    // and 100% of its close, so relaxing the threshold to `close * 1.00`
    // selects the same rows. The 5% in `dipCondition` could be deleted and
    // every case above would stay green.
    //
    // Asserted rather than described so it expires on its own: add one
    // purchase priced just under its close and this goes red, at which point
    // the margin is genuinely covered and this case should be inverted to
    // `not.toEqual` — or deleted in favour of a case that pins the threshold.
    const atFivePercent = await groundTruthIds(predicate(clausesFor("dip-buys")));
    const atClose = await groundTruthIds(sql`t.code = 'P' and exists (
      select 1 from daily_prices dp
       where dp.symbol = c.ticker
         and dp.market = t.country
         and dp.price_date = t.txn_date
         and t.price <= dp.close)`);

    // Without this, an empty dip screen would make the comparison below
    // vacuously true and the gap would look closed when it had merely emptied.
    expect(
      atFivePercent.length,
      "no dip rows at all — the fixture lost its price context",
    ).toBeGreaterThan(0);
    expect(
      atClose,
      "the seed now separates a 5% dip from any dip; the threshold is covered — invert this",
    ).toEqual(atFivePercent);
  });
});

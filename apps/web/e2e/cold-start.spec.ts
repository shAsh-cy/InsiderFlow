import { expect, test } from "@playwright/test";

/**
 * What a contributor actually gets from `docker compose down -v && up`.
 *
 * The audit found two of seven presets and the whole leaderboard rendering
 * empty on a fresh stack, because migrations and the seed leave every derived
 * table empty and nothing ran the analytics pass. Worse than empty:
 * `cluster-buys` returned zero while the query-time definition returned one
 * company, so it was a WRONG answer, not a missing feature.
 *
 * Nothing in the unit suite could catch that. The cluster parity test compares
 * the two paths only AFTER maintenance has run — the state it seeds — so the
 * cold state was invisible to it by construction. This asserts the product,
 * from outside, in the state a first-time reader meets.
 *
 * Run against the compose stack:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/cold-start.spec.ts
 */

/** Every preset the API exposes. Keep in sync with SCREENER_PRESETS. */
const PRESETS = [
  "latest",
  "big-buys",
  "cluster-buys",
  "exec-buys",
  "dip-buys",
  "big-discretionary-sales",
  "unusual-flow",
] as const;

test.describe("seeded stack delivers the documented product", () => {
  for (const preset of PRESETS) {
    test(`screener preset "${preset}" returns rows`, async ({ request }) => {
      const response = await request.get(`/api/screener/${preset}?limit=50`);
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { data: unknown[]; meta: { count: number } };
      expect(
        body.meta.count,
        `${preset} returned nothing. On a seeded stack that reads as broken software — ` +
          `run the analytics one-shot (docker compose up analytics) or check its logs.`,
      ).toBeGreaterThan(0);
      expect(body.data.length).toBeGreaterThan(0);
    });
  }

  test("the cluster preset agrees with the query-time definition it is derived from", async ({
    request,
  }) => {
    // The specific failure: flags empty, SQL definition non-empty, API says 0.
    // Both paths must now name the same companies whichever one is serving.
    type TradeRow = { company: { ticker: string | null } };
    const viaPreset = (await (await request.get("/api/screener/cluster-buys?limit=50")).json()) as {
      data: TradeRow[];
    };
    const viaFilter = (await (
      await request.get("/api/trades?cluster=true&code=P&limit=50")
    ).json()) as { data: TradeRow[] };

    const tickersOf = (items: TradeRow[]) =>
      [...new Set(items.map((i) => i.company.ticker))].sort();
    expect(tickersOf(viaPreset.data)).toEqual(tickersOf(viaFilter.data));
    expect(tickersOf(viaPreset.data).length).toBeGreaterThan(0);
  });

  test("the leaderboard returns scored insiders", async ({ request }) => {
    const response = await request.get("/api/leaderboard?limit=50");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { data: Array<{ insiderId: string }> };
    expect(
      body.data.length,
      "empty leaderboard — the scoring step did not run, or the seed has no insider with " +
        "enough scorable trades to clear the default min_trades threshold",
    ).toBeGreaterThan(0);
  });

  test("the leaderboard page renders those insiders rather than an empty state", async ({
    page,
  }) => {
    await page.goto("/leaderboard");
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.getByRole("row").count()).toBeGreaterThan(1); // header + data
  });

  test("health does not report the cluster fallback on a properly seeded stack", async ({
    request,
  }) => {
    // The fallback keeps the preset CORRECT when maintenance has never run, but
    // it is not the designed path. On a stack that ran the analytics one-shot
    // it must be off — otherwise the one-shot silently did nothing.
    const body = (await (await request.get("/api/health")).json()) as {
      checks: Array<{ name: string; level: string; detail: string }>;
    };
    const cluster = body.checks.find((c) => c.name === "cluster_flags");
    expect(cluster, "health must report a cluster_flags check").toBeDefined();
    expect(cluster!.detail).not.toContain("falling back");
  });
});

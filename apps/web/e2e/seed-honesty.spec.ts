import { expect, test } from "@playwright/test";

/**
 * The seed's own honesty, and the India panels it never populated.
 *
 * docs/architecture.md states the invariant plainly: **a missing value is
 * never a zero.** The renderers always obeyed it. The FIXTURE did not — it
 * wrote a stock grant with `price: 0`, which surfaced as "at USD 0" in RSS and
 * a $0 column on the stock page. Synthetic and namespaced, so it could not be
 * mistaken for a real filing, but it is the first example every contributor
 * reads and it contradicted the project's headline promise.
 *
 * The India panels shipped with zero seeded rows, so all three rendered their
 * empty state and the whole feature was unprovable from a clean start. "The
 * schema exists" and "the feature works" are different claims, and only one of
 * them is testable.
 *
 * Run against the compose stack:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/seed-honesty.spec.ts
 */

test.describe("a grant has no price, and says so", () => {
  test("the API returns null rather than zero", async ({ request }) => {
    const response = await request.get("/api/trades?ticker=ZZNOVA&code=A&limit=10");
    const body = (await response.json()) as {
      data: Array<{ code: string; price: number | null; value: number | null }>;
    };
    expect(
      body.data.length,
      "the seed must contain a grant to make this meaningful",
    ).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.price, "a grant has no purchase price").toBeNull();
      expect(row.value, "and therefore no value").toBeNull();
    }
  });

  test("RSS never prints a fabricated zero price", async ({ request }) => {
    const body = await (await request.get("/api/rss/latest")).text();
    // The exact string the seeded grant used to produce.
    expect(body).not.toContain("at USD 0 ");
    expect(body).not.toMatch(/at [A-Z]{3} 0\b/);
  });

  test("no seeded transaction carries a zero price or value", async ({ request }) => {
    // Belt and braces across the whole fixture set, not just the grant: a
    // zero that means "not disclosed" is the failure mode, wherever it appears.
    const response = await request.get("/api/trades?limit=100");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ code: string; price: number | null; value: number | null }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.price, `${row.code} price`).not.toBe(0);
      expect(row.value, `${row.code} value`).not.toBe(0);
    }
  });
});

test.describe("India disclosures render from the seed", () => {
  test("all three panels show rows, not empty states", async ({ page }) => {
    await page.goto("/stock/ZZBHARAT");

    const sast = page.getByRole("region", { name: /SAST disclosures/i });
    await expect(sast).toBeVisible();
    await expect(sast.getByRole("row")).not.toHaveCount(1); // header only = empty
    await expect(sast).toContainText("ZZ Kaveri Holdings");

    const deals = page.getByRole("region", { name: /bulk|block/i }).first();
    await expect(deals).toBeVisible();
    await expect(deals).toContainText("ZZ Sundara Asset Management");

    const pledges = page.getByRole("region", { name: /pledge/i }).first();
    await expect(pledges).toBeVisible();
    await expect(pledges).toContainText("ZZ Bharat Promoter Family Trust");

    // None of the three may be showing its "no rows" copy.
    await expect(page.getByText(/No .* on record/)).toHaveCount(0);
  });

  test("a SAST filing with no disclosed consideration says so rather than inventing one", async ({
    page,
  }) => {
    // SEBI Reg. 29 requires the SHAREHOLDING, not the consideration. Most
    // filings carry no value, and deriving one — shares x yesterday's close —
    // would publish a number nobody filed.
    await page.goto("/stock/ZZBHARAT");
    const sast = page.getByRole("region", { name: /SAST disclosures/i });
    const kaveriRow = sast.getByRole("row").filter({ hasText: "ZZ Kaveri Holdings" });
    await expect(kaveriRow).toHaveCount(1);
    await expect(kaveriRow).not.toContainText(/₹\s*0\b|INR 0\b|\$0\b/);
  });
});

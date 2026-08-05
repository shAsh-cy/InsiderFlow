import { expect, test } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticClusterFlag,
  insertSyntheticPoliticianTrade,
  insertSyntheticTrade,
  psql,
} from "./fixtures";
import type { SyntheticCompany } from "./fixtures";

/**
 * Phase 8 acceptance: heatmap, leaderboard, congressional trading,
 * methodology, and locale switching.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/analytics.spec.ts
 *
 * Fixtures use the reserved ZZ* namespace, and the synthetic filer is
 * obviously fictional — see e2e/fixtures.ts.
 */

test.describe("heatmap", () => {
  test("renders a treemap and a table view of the same data", async ({ page }) => {
    await page.goto("/heatmap");
    await expect(page.getByRole("heading", { name: /Insider flow heatmap/i })).toBeVisible();
    // role=group, not role=img: an img role would make the cells presentational.
    await expect(page.getByRole("group", { name: /Net insider flow treemap/i })).toBeVisible();

    // Identity is never colour-alone: a table view of the same rows exists.
    await page.getByText(/Table view/).click();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("switches grouping and timeframe through the URL", async ({ page }) => {
    await page.goto("/heatmap");

    await page.getByRole("link", { name: "Sector", exact: true }).click();
    await expect(page).toHaveURL(/group_by=sector/);

    await page.getByRole("link", { name: "90d", exact: true }).click();
    await expect(page).toHaveURL(/timeframe=90d/);
    await expect(page).toHaveURL(/group_by=sector/);

    await page.getByRole("link", { name: "Country", exact: true }).click();
    await expect(page).toHaveURL(/group_by=country/);
  });

  test("a cell click drills into the screener with matching filters", async ({ page }) => {
    await page.goto("/heatmap");

    // The table is server-rendered, so it settles first; use it to decide
    // whether there is anything to draw at all.
    const rows = await page.locator("table tbody tr").count();
    test.skip(rows === 0, "no insider flow in the default window");

    // Cells must be reachable as buttons — this is also the assertion that the
    // SVG subtree stays in the accessibility tree (role=group, not role=img).
    // toBeVisible auto-waits; a bare .count() would race the client-side
    // measure-then-render that the treemap does on hydration.
    const cells = page.getByRole("button", { name: /net .* across .* trades/i });
    await expect(cells.first()).toBeVisible();

    await cells.first().click();
    await expect(page).toHaveURL(/\/screener\?/);
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  });
});

test.describe("leaderboard", () => {
  test("states up front that it is not advice, and links the methodology", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { name: /Insider leaderboard/i })).toBeVisible();
    // The disclaimer is above the table, not buried in a footer.
    await expect(page.getByText(/not investment advice/i).first()).toBeVisible();
    await page.getByRole("link", { name: /Read the full methodology/i }).click();
    await expect(page).toHaveURL(/\/docs\/methodology/);
  });

  test("keeps a sample-size floor and lets it be changed", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.getByRole("link", { name: "25", exact: true }).click();
    await expect(page).toHaveURL(/min_trades=25/);

    await page.getByRole("link", { name: "Hit rate", exact: true }).click();
    await expect(page).toHaveURL(/metric=hit_rate_90d/);
    await expect(page).toHaveURL(/min_trades=25/);
  });

  test("says so honestly when there is nothing scored yet", async ({ page }) => {
    await page.goto("/leaderboard?min_trades=500");
    // An empty leaderboard must explain itself rather than look broken.
    await expect(page.getByText(/enough scored trades/i)).toBeVisible();
  });
});

test.describe("methodology", () => {
  test("publishes the formulas behind every derived number", async ({ page }) => {
    await page.goto("/docs/methodology");
    await expect(page.getByRole("heading", { name: "Methodology", level: 1 })).toBeVisible();

    for (const id of ["clusters", "sectors", "scoring", "anomaly", "politicians", "limits"]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }

    // The shrinkage term and the benchmark are stated, not implied. Both
    // appear more than once (formula block + prose), hence .first().
    await expect(page.getByText(/n \/ \(n \+ 5\)/).first()).toBeVisible();
    await expect(page.getByText(/SPY/).first()).toBeVisible();
    await expect(page.getByText(/Known limitations/).first()).toBeVisible();
  });
});

test.describe("congressional trading", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZPOL");
    insertSyntheticTrade(target, { tag: "pol" });
    insertSyntheticPoliticianTrade(target);
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("lists disclosures as ranges, never as a point value", async ({ page }) => {
    await page.goto(`/politicians?ticker=${target.ticker}`);
    await expect(page.getByRole("heading", { name: /Congressional trading/i })).toBeVisible();
    await expect(page.getByText(/Amounts are ranges/i)).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(target.ticker) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("$15,001 - $50,000");
  });

  test("opens a filer profile with their disclosure history", async ({ page }) => {
    await page.goto(`/politicians?ticker=${target.ticker}`);
    await page
      .getByRole("link", { name: /ZZ Representative Fictional/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/politicians\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("ZZ Representative");
    await expect(page.getByText(/Filed late/i)).toBeVisible();
  });

  test("overlays congressional activity on the stock page", async ({ page }) => {
    await page.goto(`/stock/${target.ticker}`);
    const overlay = page.getByTestId("politician-overlay");
    await expect(overlay).toBeVisible();
    // Kept visually separate from Section 16 insider filings.
    await expect(overlay).toContainText(/Congressional disclosures/i);
    await expect(overlay).toContainText(/45 days/);
  });

  test("serves an RSS feed of the same disclosures", async ({ request }) => {
    const response = await request.get(`/api/rss/politicians?ticker=${target.ticker}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/rss+xml");
    const xml = await response.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("$15,001 - $50,000");
    expect(xml).toContain("Not investment advice");
  });

  test("serves real ingested data under the placeholder's contract", async ({ request }) => {
    const response = await request.get(`/api/politicians?ticker=${target.ticker}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
      note: string;
    };

    // The Phase 4 placeholder's shape is unchanged: data + meta + note.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ limit: expect.any(Number), offset: 0 });
    expect(body.note).toContain("brackets");

    const row = body.data[0]!;
    expect(row.amountMin).toBe(15001);
    expect(row.amountMax).toBe(50000);
    // No synthesised point value is ever added.
    expect(row).not.toHaveProperty("value");
    expect(row).not.toHaveProperty("valueUsd");
  });
});

test.describe("cluster flags", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZCLUS");
    insertSyntheticTrade(target, { tag: "clus" });
    insertSyntheticClusterFlag(target, 3);
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  // Serial: the last case DELETES the flag the other two depend on. Under
  // Playwright's default parallelism that delete raced the select, and the
  // failure looked like a product bug ("the preset does not see the flag")
  // rather than what it was — two tests sharing one row.
  test.describe.configure({ mode: "serial" });

  test("the stock-page indicator reads from the precomputed flag", async ({ page }) => {
    await page.goto(`/stock/${target.ticker}`);
    // Only one insider actually traded; the badge shows 3 because it is now
    // reading cluster_flags rather than recounting at query time.
    await expect(page.getByText(/cluster buying · 3 insiders/i)).toBeVisible();
  });

  test("the cluster preset selects the flagged company", async ({ request }) => {
    const response = await request.get(
      `/api/screener/cluster-buys?ticker=${target.ticker}&limit=5`,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { data: Array<{ company: { ticker: string } }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]!.company.ticker).toBe(target.ticker);
  });

  test("removing the flag removes it from the preset", async ({ request }) => {
    psql(`DELETE FROM cluster_flags WHERE company_id = '${target.companyId}';`);
    const response = await request.get(
      `/api/screener/cluster-buys?ticker=${target.ticker}&limit=5`,
    );
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
    insertSyntheticClusterFlag(target, 3); // restore for afterAll cleanup symmetry
  });
});

test.describe("i18n", () => {
  test("switches the shell and landing page to Hindi and back", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    // Landing copy is translated…
    await expect(page.getByRole("link", { name: /लाइव टेप देखें/ })).toBeVisible();
    // …but the product name is a proper noun and stays put.
    await expect(page.getByRole("heading", { name: "InsiderFlow", level: 1 })).toBeVisible();

    // The preference survives navigation.
    await page.goto("/trades");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("does not localize the API", async ({ request }) => {
    // Machine-readable endpoints must not shift by locale.
    const response = await request.get("/api/trades?limit=1", {
      headers: { cookie: "insiderflow-locale=hi" },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { meta: { limit: number } };
    expect(body.meta.limit).toBe(1);
  });
});

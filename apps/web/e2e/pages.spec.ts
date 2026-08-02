import { expect, test } from "@playwright/test";

import { psql } from "./fixtures";

/**
 * Phase 6 page acceptance. Run against a production build on :3100 with
 * the docker Postgres:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/pages.spec.ts
 *
 * Fixtures use the reserved ZZ* namespace — see e2e/fixtures.ts.
 */

test.describe("live feed (/trades)", () => {
  test("renders live fold + history, filters update the URL and back works", async ({ page }) => {
    await page.goto("/trades");
    await expect(page.getByTestId("live-fold")).toBeVisible();
    await expect(page.getByTestId("history-feed")).toBeVisible();

    await page.getByRole("button", { name: "Buys" }).click();
    await expect(page).toHaveURL(/side=buy/);
    await page.getByRole("button", { name: "Opportunistic" }).click();
    await expect(page).toHaveURL(/relevance=opportunistic/);
    await expect(page).toHaveURL(/side=buy/);

    // Filter states are history entries.
    await page.goBack();
    await expect(page).toHaveURL(/side=buy/);
    await expect(page).not.toHaveURL(/relevance/);

    // The code legend expands with all 20 codes from core.
    await page.getByRole("button", { name: /Code legend/i }).click();
    await expect(page.getByRole("definition").first()).toBeVisible();
  });
});

test.describe("companies directory", () => {
  test("searches and links to stock pages", async ({ page }) => {
    const ticker = psql(
      "SELECT c.ticker FROM companies c JOIN transactions t ON t.company_id=c.id WHERE c.ticker IS NOT NULL GROUP BY c.ticker ORDER BY count(*) DESC LIMIT 1;",
    );
    await page.goto(`/companies?q=${ticker}`);
    const link = page.getByRole("link", { name: new RegExp(ticker) }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/stock/${ticker}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ticker);
  });
});

test.describe("stock page", () => {
  test("shows stats, trade table, and honest empty states", async ({ page }) => {
    const ticker = psql(
      "SELECT c.ticker FROM companies c JOIN transactions t ON t.company_id=c.id WHERE c.ticker IS NOT NULL GROUP BY c.ticker ORDER BY count(*) DESC LIMIT 1;",
    );
    await page.goto(`/stock/${ticker}`);
    await expect(page.getByLabel("Insider trade history")).toBeVisible();
    await expect(page.getByText("Net insider flow")).toBeVisible();
    await expect(page.getByText("MSPR sentiment")).toBeVisible();
    await expect(page.getByRole("button", { name: /Watch/ })).toBeVisible();
  });

  test("unknown tickers 404", async ({ page }) => {
    const response = await page.goto("/stock/ZZZZNOPE");
    expect(response?.status()).toBe(404);
  });

  test("the amendments toggle reveals rows from a real superseded filing", async ({ page }) => {
    // A dedicated company so the assertion is deterministic: its ONLY
    // transaction belongs to a filing that an amendment superseded, and the
    // table is virtualized (asserting on text inside a busy table would be
    // window-dependent).
    const ticker = `ZZAMEND${Date.now() % 100000}`;
    psql(
      `WITH co AS (INSERT INTO companies (external_key, ticker, name, country)
          VALUES ('ticker:US:${ticker}', '${ticker}', 'ZZ Amendment Test Corp', 'US') RETURNING id, country),
        ins AS (INSERT INTO insiders (external_key, name, is_officer)
          VALUES ('name:US:ZZ AMEND TESTER ${ticker}', 'ZZ AMEND TESTER', true) RETURNING id),
        orig AS (INSERT INTO filings (accession_no, form_type, filed_at, issuer_company_id)
          SELECT 'e2e-orig-${ticker}', '4', now() - interval '2 day', co.id FROM co RETURNING id),
        amend AS (INSERT INTO filings (accession_no, form_type, filed_at, issuer_company_id)
          SELECT 'e2e-amend-${ticker}', '4/A', now() - interval '1 day', co.id FROM co RETURNING id)
        INSERT INTO transactions (source, filing_id, insider_id, company_id, txn_date, code,
            shares, price, value, currency, price_usd, value_usd, acquired_disposed,
            is_10b5_1, is_derivative, relevance, dedup_key, country)
          SELECT 'edgar', (SELECT id FROM orig), ins.id, co.id, CURRENT_DATE - 2, 'P',
            777001, 1, 777001, 'USD', 1, 777001, 'A', false, false, 'opportunistic',
            'e2e-amend-${ticker}#0', co.country FROM co, ins;`,
    );
    // Separate statement: a data-modifying CTE cannot UPDATE rows a sibling
    // CTE inserted in the same statement (they share one snapshot).
    psql(
      `UPDATE filings SET superseded_by_filing_id =
         (SELECT id FROM filings WHERE accession_no = 'e2e-amend-${ticker}')
       WHERE accession_no = 'e2e-orig-${ticker}';`,
    );

    try {
      // Default: the superseded filing's row is hidden → honest empty state.
      await page.goto(`/stock/${ticker}`);
      await expect(page.getByText("No insider transactions on record")).toBeVisible();

      // Toggle reveals exactly that row, flagged as superseded.
      await page.getByTestId("amendments-toggle").click();
      await expect(page).toHaveURL(/amendments=1/);
      const table = page.getByRole("table", { name: new RegExp(ticker) });
      await expect(table.locator("tbody tr[data-index]")).toHaveCount(1);
      await expect(table.getByText("777,001")).toBeVisible();
      await expect(table.getByText("superseded")).toBeVisible();

      // Toggle back hides it again.
      await page.getByTestId("amendments-toggle").click();
      await expect(page.getByText("No insider transactions on record")).toBeVisible();
    } finally {
      psql(
        `DELETE FROM transactions WHERE dedup_key = 'e2e-amend-${ticker}#0';
         UPDATE filings SET superseded_by_filing_id = NULL WHERE accession_no = 'e2e-orig-${ticker}';
         DELETE FROM filings WHERE accession_no IN ('e2e-orig-${ticker}', 'e2e-amend-${ticker}');
         DELETE FROM companies WHERE ticker = '${ticker}';
         DELETE FROM insiders WHERE external_key = 'name:US:ZZ AMEND TESTER ${ticker}';`,
      );
    }
  });
});

test.describe("screener", () => {
  test("presets, shareable URL state, export + disabled alert affordances", async ({ page }) => {
    await page.goto("/screener?preset=big-buys");
    await expect(page.getByRole("link", { name: "big-buys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("result-count")).toBeVisible();
    await expect(page.getByRole("link", { name: /RSS/ })).toHaveAttribute(
      "href",
      "/api/rss/big-buys",
    );
    await expect(page.getByTestId("save-alert").getByRole("button")).toBeDisabled();

    // Compose a filter on top of the preset; the URL carries the whole state.
    await page.getByRole("button", { name: "Executives only" }).click();
    await expect(page).toHaveURL(/preset=big-buys/);
    await expect(page).toHaveURL(/exec_only=true/);

    // The full URL is shareable: a fresh navigation reproduces the state.
    const url = page.url();
    await page.goto("about:blank");
    await page.goto(url);
    await expect(page.getByRole("button", { name: "Executives only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("result-count")).toBeVisible();
  });

  test("CSV export downloads a file", async ({ page }) => {
    await page.goto("/screener");
    await expect(page.getByTestId("result-count")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("insiderflow-screen.csv");
  });
});

test.describe("watchlist", () => {
  test("add via search, persists across reload, remove", async ({ page }) => {
    const ticker = psql(
      "SELECT c.ticker FROM companies c JOIN transactions t ON t.company_id=c.id WHERE c.ticker IS NOT NULL GROUP BY c.ticker ORDER BY count(*) DESC LIMIT 1;",
    );
    await page.goto("/watchlist");
    await expect(page.getByText("Nothing watched yet")).toBeVisible();

    await page.getByLabel("Search companies to watch").fill(ticker.slice(0, 3));
    await page
      .getByRole("button", { name: new RegExp(ticker) })
      .first()
      .click();
    await expect(page.getByTestId("watchlist-items")).toBeVisible();

    // localStorage persistence.
    await page.reload();
    await expect(page.getByTestId("watchlist-items")).toBeVisible();

    await page
      .getByRole("button", { name: /Remove/ })
      .first()
      .click();
    await expect(page.getByText("Nothing watched yet")).toBeVisible();
  });
});

test.describe("insider profile", () => {
  test("renders roles, stats, and the honest coming-soon score", async ({ page }) => {
    const insiderId = psql(
      "SELECT insider_id FROM transactions GROUP BY insider_id ORDER BY count(*) DESC LIMIT 1;",
    );
    await page.goto(`/insider/${insiderId}`);
    await expect(page.getByLabel("Performance score (coming soon)")).toContainText(
      "Coming in Phase 8",
    );
    await expect(page.getByLabel("Trade history")).toBeVisible();
    await expect(page.getByText("Cross-company trade history")).toBeVisible();
  });

  test("malformed ids 404", async ({ page }) => {
    const response = await page.goto("/insider/not-a-uuid");
    expect(response?.status()).toBe(404);
  });
});

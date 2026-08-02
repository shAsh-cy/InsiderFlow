import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

/**
 * End-to-end proof of the useTradeStream contract against the real API +
 * Postgres: a DB insert appears in the live strip without a refresh, and
 * the strip survives the server's ~25s SSE window close without flicker.
 *
 * Requires the app running against the docker Postgres, e.g.
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/live-stream.spec.ts
 */

/** Unique per run so assertions never collide with rows left by earlier runs. */
function uniqueShares(): number {
  return 900_000 + Math.floor(Math.random() * 99_999);
}

function insertLiveTrade(shares: number): void {
  // No shell: docker + psql args are passed directly (the SQL is one argv entry).
  const sql =
    "INSERT INTO transactions " +
    "(source, insider_id, company_id, txn_date, code, shares, price, value, currency, " +
    "price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative, relevance, dedup_key, country) " +
    `SELECT 'edgar', i.id, c.id, CURRENT_DATE, 'P', ${shares}, 12.5, ${shares * 12.5}, 'USD', ` +
    `12.5, ${shares * 12.5}, 'A', false, false, 'opportunistic', 'e2e-live-${shares}#0', 'US' ` +
    "FROM insiders i CROSS JOIN companies c LIMIT 1;";
  execFileSync(
    "docker",
    ["exec", "insiderflow-postgres", "psql", "-U", "postgres", "-d", "insiderflow", "-c", sql],
    { stdio: "ignore" },
  );
}

// Deliberately long: the test must outlive a full ~25s server window.
test.setTimeout(120_000);

test("live strip shows a DB insert and survives the SSE window close", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const feed = page.getByTestId("live-feed");
  await expect(feed).toBeVisible({ timeout: 15_000 });
  expect(await feed.locator("li").count()).toBeGreaterThan(0); // seeded from /api/trades

  // Insert a row directly into Postgres — nothing on the client triggers it.
  const shares = uniqueShares();
  insertLiveTrade(shares);
  const marker = `${shares.toLocaleString("en-US")} sh`;

  // It must stream in (no refresh) and land at the top of the tape. The
  // strip is capped at `limit`, so the row count stays flat — identity is
  // what matters, not length.
  const inserted = feed.getByText(marker);
  await expect(inserted).toHaveCount(1, { timeout: 25_000 });
  await expect(feed.locator("li").first()).toContainText(marker);
  const afterInsert = await feed.locator("li").count();

  // Hold past a full server window (~25s) so the server closes the stream
  // and EventSource reconnects with Last-Event-ID. Nothing may change:
  // no clearing, no duplicate row from the replay.
  await page.waitForTimeout(31_000);
  expect(await feed.locator("li").count()).toBe(afterInsert);
  await expect(inserted).toHaveCount(1);
  await expect(feed.locator("li").first()).toContainText(marker);
});

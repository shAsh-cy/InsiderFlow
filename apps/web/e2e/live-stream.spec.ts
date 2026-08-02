import { expect, test } from "@playwright/test";

import { cleanupSyntheticCompany, createSyntheticCompany, insertSyntheticTrade } from "./fixtures";
import type { SyntheticCompany } from "./fixtures";

/**
 * End-to-end proof of the useTradeStream contract against the real API +
 * Postgres: a DB insert appears in the live strip without a refresh, and
 * the strip survives the server's ~25s SSE window close without flicker.
 *
 * The insert goes to a synthetic ZZ* company — fabricated trades are never
 * attached to a real ticker (see e2e/fixtures.ts).
 *
 * Requires the app running against the docker Postgres, e.g.
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/live-stream.spec.ts
 */

// Deliberately long: the test must outlive a full ~25s server window.
test.setTimeout(120_000);

test("live strip shows a DB insert and survives the SSE window close", async ({ page }) => {
  let target: SyntheticCompany | null = null;
  try {
    await page.goto("/", { waitUntil: "networkidle" });

    const feed = page.getByTestId("live-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });
    expect(await feed.locator("li").count()).toBeGreaterThan(0); // seeded from /api/trades

    // Insert a row directly into Postgres — nothing on the client triggers it.
    target = createSyntheticCompany("ZZLIVE");
    const shares = 900_000 + Math.floor(Math.random() * 99_999);
    insertSyntheticTrade(target, { shares, price: 12.5 });
    const marker = `${shares.toLocaleString("en-US")} sh`;

    // It must stream in (no refresh) and land at the top of the tape. The
    // strip is capped, so the row count stays flat — identity is what
    // matters, not length.
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
  } finally {
    if (target) cleanupSyntheticCompany(target);
  }
});

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

/**
 * Contends for a genuinely scarce product resource.
 *
 * `/api/stream` caps concurrent SSE connections at four per client identity,
 * and every Playwright worker shares one loopback address — so a suite running
 * eight workers can spend the whole allowance before this test opens its own
 * connection. The cap is correct and is asserted elsewhere; raising it for the
 * harness is not an option either, because a browser only holds six
 * connections per origin.
 *
 * So: retry rather than weaken. Nothing about what this test proves changes;
 * it just gets a second attempt once the other workers have handed their slots
 * back. A failure that survives the retry is a real one.
 */
// No retries any more: the contention this used to work around is gone.
// These tests run in their own serial `stream` project (see
// playwright.config.ts), so nothing else is holding an SSE slot while
// they run, and a failure here is now a real one.

// Deliberately long: the test must outlive a full ~25s server window.
test.setTimeout(120_000);

test("live strip shows a DB insert and survives the SSE window close @stream", async ({ page }) => {
  let target: SyntheticCompany | null = null;
  try {
    await page.goto("/", { waitUntil: "networkidle" });

    const feed = page.getByTestId("live-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });
    expect(await feed.locator("li").count()).toBeGreaterThan(0); // seeded from /api/trades

    // The newest row BEFORE our insert. Ordering is asserted against this
    // rather than against absolute position 0: other specs run in parallel and
    // may insert their own trades during the 31-second hold below, and those
    // rows legitimately belong above ours. "Newer than everything that existed
    // when we started" is the real invariant; "is literally first" was an
    // accident of nothing else running.
    const previousTop = ((await feed.locator("li").first().textContent()) ?? "").trim();

    // Insert a row directly into Postgres — nothing on the client triggers it.
    target = createSyntheticCompany("ZZLIVE");
    const shares = 900_000 + Math.floor(Math.random() * 99_999);
    insertSyntheticTrade(target, { shares, price: 12.5 });
    const marker = `${shares.toLocaleString("en-US")} sh`;

    // It must stream in (no refresh) and sit above everything that was already
    // on the tape. The strip is capped, so the row count stays flat — identity
    // is what matters, not length.
    const inserted = feed.getByText(marker);
    await expect(inserted).toHaveCount(1, { timeout: 25_000 });
    const positionOf = async (text: string): Promise<number> =>
      (await feed.locator("li").allTextContents()).findIndex((t) => t.trim().includes(text));
    const ourIndex = await positionOf(marker);
    const previousTopIndex = await positionOf(previousTop);
    expect(ourIndex, "the new trade must be on the tape").toBeGreaterThanOrEqual(0);
    if (previousTopIndex >= 0) {
      expect(ourIndex, "a newer trade must sort above an older one").toBeLessThan(previousTopIndex);
    }
    const afterInsert = await feed.locator("li").count();

    // Hold past a full server window (~25s) so the server closes the stream
    // and EventSource reconnects with Last-Event-ID. Nothing may change:
    // no clearing, no duplicate row from the replay.
    await page.waitForTimeout(31_000);
    expect(await feed.locator("li").count()).toBe(afterInsert);
    // Still exactly one — the reconnect replays from Last-Event-ID and must
    // not duplicate the row, which is the whole point of the cursor.
    await expect(inserted).toHaveCount(1);
  } finally {
    if (target) cleanupSyntheticCompany(target);
  }
});

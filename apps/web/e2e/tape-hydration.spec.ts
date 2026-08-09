import { test, expect, type Page } from "@playwright/test";

/**
 * STATIC FIRST, LIVE SECOND (r6).
 *
 * The landing tape's rows are server-rendered. The stream is what keeps
 * them current, not what puts them there — so the page must be honest
 * about which of those two states it is in, and the upgrade between them
 * must move nothing.
 *
 * What this pins:
 *   - Before the stream attaches, the tape says "as of <time>" and makes
 *     no claim to be live. It used to mount an indicator reading
 *     "Connecting" during hydration, which described an intention rather
 *     than a state: the connection had been deliberately deferred.
 *   - The indicator appears only once the stream is actually up.
 *   - The stamp beside it does not move when that happens.
 */

/** The tape's freshness stamp, wherever the header has right-aligned it. */
async function stampX(page: Page): Promise<number> {
  const box = await page.getByTestId("tape-as-of").boundingBox();
  return box!.x;
}

test.describe("the landing tape upgrades from a snapshot", () => {
  // Two of these need a real SSE connection, and `/api/stream` caps
  // concurrent connections at four per IP — every Playwright worker on this
  // box is the same IP. That ceiling is the product working as designed, so
  // it is retried rather than raised. Same reasoning as e2e/tape.spec.ts.
  test.describe.configure({ retries: 2 });

  test("claims nothing before the stream is up", async ({ page }) => {
    // Held open, not refused: a refused stream falls back to polling, which
    // IS an attached state and would legitimately show an indicator. A
    // request that never answers is the "not yet" this test is about.
    await page.route("**/api/stream**", () => {
      /* never fulfilled */
    });
    await page.goto("/");

    // Attached and empty, not "visible": before the stream is up this box
    // is holding a width and nothing else, and an empty inline-flex has no
    // height for Playwright's visibility check to find. Holding the width
    // is the entire job — the "stamp does not move" test below is what
    // proves it is doing it.
    const slot = page.getByTestId("tape-live-slot");
    await expect(slot).toBeAttached();
    await expect(page.getByTestId("tape-as-of"), "the snapshot says when").toBeVisible();

    // Give idle and the 1.5s deadline both time to pass.
    await page.waitForTimeout(2500);
    await expect(slot, "no indicator until the stream attaches").toHaveText("");
    // Scoped to the slot, deliberately: the tape's own heading is "Live
    // filings", which is a name for the section and not a claim about a
    // connection. Asserting on the whole section would fail on its title.
    await expect(slot).not.toContainText(/live|polling|connecting/i);
    // …and the rows are on screen regardless, because they were in the HTML.
    await expect(page.getByTestId("live-feed").locator("[data-tape-row]").first()).toBeVisible();
  });

  test("shows the indicator once it is up, and the stamp does not move", async ({ page }) => {
    await page.route("**/api/stream**", async (route) => {
      // Hold it long enough to measure the pre-attach layout, then let it
      // through so the upgrade is a real one.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto("/");

    await expect(page.getByTestId("tape-live-slot")).toHaveText("");
    const before = await stampX(page);

    await expect(page.getByTestId("tape-live-slot")).toContainText(/live|polling/i, {
      timeout: 20_000,
    });
    const after = await stampX(page);

    // The whole point of reserving the slot's width. The meta row is
    // right-aligned, so without it the stamp slides left the moment the
    // indicator mounts — a layout shift caused by good news.
    expect(
      Math.abs(after - before),
      `stamp moved ${Math.round(after - before)}px on upgrade`,
    ).toBeLessThanOrEqual(1);
  });

  test("the reader's first interaction starts the stream", async ({ page }) => {
    await page.goto("/");
    // Not a proof that interaction beat idle — idle is 1.5s and this is a
    // fast machine. What it does pin is that interacting does not PREVENT
    // or double-start it, which is the failure mode of adding a second
    // trigger. Which trigger wins is unit-tested in lib/activation.test.ts
    // against a fake host, where it can be made deterministic.
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId("tape-live-slot")).toContainText(/live|polling/i, {
      timeout: 20_000,
    });
  });
});

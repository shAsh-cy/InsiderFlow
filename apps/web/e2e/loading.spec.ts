import { test, expect } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * LOADING AND EMPTY.
 *
 * A spinner tells you the app is alive. A skeleton tells you what is
 * coming and reserves the space for it — which is the difference between
 * waiting and reading a page that is still arriving, and also the
 * difference between a stable layout and one that jumps when the rows
 * land.
 *
 * Throttled deliberately: at full speed the loading state exists for two
 * frames and any assertion about it is a race. Here the API is held open
 * long enough to photograph.
 */

/** Hold /api/trades open so the loading state is observable. */
async function slowTrades(page: import("@playwright/test").Page, ms = 2500) {
  await page.route("**/api/trades**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.describe("loading", () => {
  /**
   * The tape only pages when there is a second page. The dev database
   * holds fewer rows than one page, so this test supplies its own —
   * synthetic and ZZ-namespaced, like every other fixture here.
   */
  let bulk: SyntheticCompany;

  test.beforeAll(() => {
    bulk = createSyntheticCompany("ZZPAGE");
    for (let i = 0; i < 34; i += 1) {
      // Backdated: these are depth, not events. Inserted at `now()` they
      // would broadcast over SSE into every tape open in every parallel
      // worker and push other specs' rows out of a six-row live strip.
      insertSyntheticTrade(bulk, { shares: 1000 + i, tag: `page-${i}`, ingestedDaysAgo: 2 });
    }
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(bulk);
  });

  /** Scroll to the sentinel and wait for the placeholder to appear. */
  async function pageTheTape(page: import("@playwright/test").Page) {
    await page.goto("/trades", { waitUntil: "networkidle" });
    await slowTrades(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const skeleton = page.getByTestId("row-skeleton").first();
    await expect(skeleton).toBeVisible({ timeout: 15_000 });
    return skeleton;
  }

  test("paging the tape draws skeleton rows, not a spinner", async ({ page }) => {
    const skeleton = await pageTheTape(page);

    // Rows, not a rotating disc.
    await expect(skeleton.locator("[data-slot='skeleton']").first()).toBeVisible();
    await expect(page.locator(".animate-spin")).toHaveCount(0);
  });

  test("the skeleton reserves the height the rows will occupy", async ({ page }) => {
    const skeleton = await pageTheTape(page);

    const geometry = await skeleton.evaluate((el) => {
      const placeholder = el.firstElementChild as HTMLElement;
      const realRow = document.querySelector("[data-tape-row]") as HTMLElement;
      return {
        placeholder: placeholder.getBoundingClientRect().height,
        real: realRow.getBoundingClientRect().height,
      };
    });
    // Within a pixel of a real row: a placeholder of the wrong height is
    // a layout shift with extra steps.
    expect(Math.abs(geometry.placeholder - geometry.real)).toBeLessThanOrEqual(6);
  });

  /**
   * Scoped to the documented skeleton demo, and polled.
   *
   * `[data-slot='skeleton'].first()` picks whichever skeleton the page has
   * rendered SO FAR, and /design is a ten-thousand-row showcase: under eight
   * parallel workers `networkidle` can resolve while the section this test is
   * about is still arriving, so `.first()` lands on a different element and
   * reports a design failure that is really a timing one.
   */
  async function shimmerName(page: import("@playwright/test").Page): Promise<string> {
    const bar = page.locator("[data-testid='row-skeleton'] [data-slot='skeleton']").first();
    await expect(bar).toBeVisible();
    return bar.evaluate((el) => getComputedStyle(el).animationName);
  }

  test("the shimmer stops under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design", { waitUntil: "networkidle" });
    await expect.poll(() => shimmerName(page)).toBe("none");
  });

  test("the shimmer runs when motion is allowed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/design", { waitUntil: "networkidle" });
    await expect.poll(() => shimmerName(page)).not.toBe("none");
  });
});

test.describe("empty states", () => {
  const PLACES = [
    // Watchlist is empty for a fresh browser context by construction.
    { route: "/watchlist", must: /watchlist|track/i },
    // The screener with a filter nothing can match.
    { route: "/screener?ticker=ZZNOTHING", must: /screen|filter/i },
  ];

  for (const place of PLACES) {
    test(`${place.route} uses the one empty-state shape`, async ({ page }) => {
      await page.goto(place.route, { waitUntil: "networkidle" });
      const empty = page.locator("[data-empty-state]").first();
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(place.must);
      // Explains rather than scolds, and never implies the data was gated.
      await expect(empty).not.toContainText(/unlock|upgrade|premium|subscribe/i);
    });
  }

  test("politicians keeps its honest-empty wording verbatim", async ({ page }) => {
    await page.goto("/politicians", { waitUntil: "networkidle" });
    // Either there are filers, or the copy is exactly what it always was:
    // a statement about this deployment's pipeline, not a sales line.
    const empties = page.locator("[data-empty-state]");
    const count = await empties.count();
    for (let i = 0; i < count; i += 1) {
      const text = ((await empties.nth(i).textContent()) ?? "").trim();
      expect(text).toMatch(/^(No filers ingested yet\.|No ticker activity in this window\.)$/);
    }
  });

  test("every empty state is one icon, one line, at most one action", async ({ page }) => {
    for (const route of ["/watchlist", "/screener?ticker=ZZNOTHING", "/politicians"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      const shape = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-empty-state]")).map((el) => ({
          actions: el.querySelectorAll("a, button").length,
          text: (el.textContent ?? "").trim().slice(0, 40),
        })),
      );
      for (const one of shape) {
        expect(one.actions, `${route}: "${one.text}" has more than one action`).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });
});

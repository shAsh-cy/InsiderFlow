import { test, expect } from "@playwright/test";

/**
 * NAV TRUTH.
 *
 * The navigation makes two claims: "you are here" and "this is the
 * product". Before r3 it made the first one nowhere and the second one in a
 * way that looked like the first — a 4px accent rule beside the wordmark,
 * identical to the sidebar's own current-page marker, which readers
 * reasonably took for a highlight stuck on.
 *
 * These tests pin: exactly one current page, never the brand, and a
 * visible focus ring on everything you can tab to up there.
 */

/** Routes that genuinely belong to a nav section. */
const OWNED = ["/trades", "/screener", "/companies", "/leaderboard", "/politicians"];

/** Routes that belong to no section — nothing may claim them. */
const UNOWNED = ["/stock/ZZNOVA", "/settings"];

test.describe("navigation state", () => {
  test("exactly one nav item is current on each owned route", async ({ page }) => {
    for (const route of OWNED) {
      await page.goto(route);
      const current = page.locator("nav [aria-current='page']");
      await expect(current, `${route}: one current nav item`).toHaveCount(1);
      // …and it is the one whose href is the route.
      await expect(current).toHaveAttribute("href", route);
    }
  });

  test("no nav item claims a route it does not own", async ({ page }) => {
    for (const route of UNOWNED) {
      await page.goto(route);
      await expect(
        page.locator("nav [aria-current='page']"),
        `${route}: nothing in the index owns this page`,
      ).toHaveCount(0);
    }
  });

  test("reference pages highlight their own entries", async ({ page }) => {
    for (const [route, href] of [
      ["/design", "/design"],
      ["/docs", "/docs"],
      ["/docs/methodology", "/docs/methodology"],
    ] as const) {
      await page.goto(route);
      const current = page.locator("nav [aria-current='page']");
      await expect(current, `${route}: one current item`).toHaveCount(1);
      await expect(current).toHaveAttribute("href", href);
    }
  });

  test("the brand is never styled or marked as active", async ({ page }) => {
    for (const route of ["/", "/trades", "/design", "/settings"]) {
      await page.goto(route);
      const brand = page.locator("[data-brand]");
      await expect(brand).toHaveCount(1);
      await expect(brand, `${route}: the brand must not be current`).not.toHaveAttribute(
        "aria-current",
        "page",
      );
      // It must also not carry the marker the sidebar uses for state — a
      // left accent rule beside a label is what made it read as active.
      // Re-queried inside the page rather than through an element handle:
      // a handle captured before hydration can be detached by the time it
      // is measured, and getComputedStyle on a detached node returns empty
      // strings that fail for reasons that have nothing to do with borders.
      const rule = await page.evaluate(() => {
        const el = document.querySelector("[data-brand]");
        if (!el) return null;
        const s = getComputedStyle(el);
        return { width: parseFloat(s.borderLeftWidth) || 0, style: s.borderLeftStyle };
      });
      expect(rule, `${route}: the brand must be in the DOM`).not.toBeNull();
      expect(
        rule!.width === 0 || rule!.style === "none",
        `${route}: the brand must not carry a left rule`,
      ).toBe(true);
    }
  });

  test("the top bar no longer duplicates the sidebar's reference section", async ({ page }) => {
    await page.goto("/trades");
    const header = page.locator("header").first();
    // Design and API docs live in the sidebar's Reference section, once.
    await expect(header.getByRole("link", { name: /design/i })).toHaveCount(0);
    await expect(header.getByRole("link", { name: /api docs/i })).toHaveCount(0);
    // What the top bar keeps: search, language, theme, settings, sign-in.
    await expect(header.getByRole("button", { name: /search/i })).toHaveCount(1);
    await expect(header.getByRole("link", { name: "Settings" })).toHaveCount(1);
  });

  test("settings gets a real active state in the top bar", async ({ page }) => {
    await page.goto("/trades");
    await expect(page.locator("header [aria-current='page']")).toHaveCount(0);

    await page.goto("/settings");
    const settings = page.locator("header [aria-current='page']");
    await expect(settings).toHaveCount(1);
    await expect(settings).toHaveAttribute("href", "/settings");
  });

  test("every nav item shows a focus ring when tabbed to", async ({ page }) => {
    await page.goto("/trades");
    const items = page.locator("aside nav a");
    const count = await items.count();
    expect(count).toBeGreaterThan(5);

    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      await item.focus();
      const outline = await item.evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: parseFloat(s.outlineWidth), style: s.outlineStyle };
      });
      const label = await item.textContent();
      expect(outline.width, `${label?.trim()} has no focus ring`).toBeGreaterThan(0);
      expect(outline.style).not.toBe("none");
    }
  });

  test("the current sidebar item is marked by more than colour", async ({ page }) => {
    await page.goto("/screener");
    const current = page.locator("aside nav [aria-current='page']");
    const marks = await current.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        rule: parseFloat(s.borderLeftWidth),
        weight: s.fontWeight,
        ground: s.backgroundColor,
      };
    });
    // A rule in the margin, heavier ink, and a tinted ground — so the state
    // survives greyscale, and `aria-current` carries it to anyone not
    // looking at the screen at all.
    expect(marks.rule).toBeGreaterThan(0);
    expect(Number(marks.weight)).toBeGreaterThanOrEqual(500);
    expect(marks.ground).not.toBe("rgba(0, 0, 0, 0)");
  });
});

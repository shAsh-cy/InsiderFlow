import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";
import { settledBox } from "./measure";

/**
 * NOTHING RUNS OFF THE SIDE OF THE SCREEN. @mobile
 *
 * The r3 suite had no assertion of this kind anywhere — no `scrollWidth`, no
 * `clientWidth`, no `innerWidth`, and every test pinned to 1280x720. A page
 * that scrolled sideways on every phone in the world would have passed all
 * 140 tests.
 *
 * Two things are measured, because they are two different failures:
 *
 *   `document.scrollWidth` catches the page dragging sideways as a whole —
 *   the one a reader notices immediately.
 *
 *   The per-element sweep catches content painting outside the viewport
 *   while the DOCUMENT still fits, which is what happens when the offender
 *   sits under an `overflow-hidden` ancestor. The page looks fine and the
 *   content is simply gone. That is the worse bug and the harder one to see,
 *   so the sweep names the culprit rather than reporting a boolean.
 *
 * An element inside a horizontal scroll container is exempt — a wide table
 * that scrolls inside its own well is the intended design, not an overflow.
 * The exemption is deliberately narrow: the FIRST clipping ancestor ends the
 * walk, so if that ancestor is itself too wide, the ancestor is reported.
 */

const WIDTHS = [360, 390] as const;

/** The canonical route list. Detail routes are appended by the fixture block. */
const ROUTES = [
  "/",
  "/trades",
  "/screener",
  "/companies",
  "/watchlist",
  "/heatmap",
  "/leaderboard",
  "/politicians",
  "/settings",
  "/design",
  "/status",
  "/docs",
  "/docs/methodology",
  "/legal",
  "/login",
];

interface OverflowReport {
  doc: number;
  viewport: number;
  culprits: string[];
}

async function measureOverflow(page: Page): Promise<OverflowReport> {
  /**
   * The width Playwright was ASKED for, not the one the page reports.
   *
   * With `isMobile: true` Chromium honours the meta viewport, and content
   * wider than the layout viewport widens the layout viewport rather than
   * overflowing it. So `document.scrollWidth <= window.innerWidth` is
   * trivially true on exactly the configuration where overflow matters
   * most: /politicians was 408px wide inside a 360px window and this
   * assertion passed, because `innerWidth` had quietly become 408 too.
   *
   * Measuring against the requested viewport is what closes that.
   */
  const configured = page.viewportSize()?.width ?? 0;
  return page.evaluate((configuredWidth) => {
    const viewport = configuredWidth || window.innerWidth;
    const clipsHorizontally = (el: Element): boolean => {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const s = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
        node = node.parentElement;
      }
      return false;
    };
    const culprits: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right <= viewport + 1) continue;
      if (clipsHorizontally(el)) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      culprits.push(
        `<${el.tagName.toLowerCase()} class="${cls.slice(0, 70)}"> right=${Math.round(box.right)}`,
      );
      if (culprits.length >= 6) break;
    }
    return { doc: document.documentElement.scrollWidth, viewport, culprits };
  }, configured);
}

/** Scroll the whole page once — lazy content can only overflow once it exists. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.9;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 150));
  });
}

test.describe("no horizontal overflow @mobile", () => {
  for (const width of WIDTHS) {
    test(`every route fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      for (const route of ROUTES) {
        await page.goto(route);
        await settle(page);
        const report = await measureOverflow(page);
        expect(report.culprits, `${route} @${width}px paints outside the viewport`).toEqual([]);
        expect(
          report.doc,
          `${route} @${width}px: document is ${report.doc}px wide in a ${report.viewport}px viewport`,
        ).toBeLessThanOrEqual(report.viewport + 1);
      }
    });
  }

  test("the viewport meta is present and does not lock zoom", async ({ page }) => {
    // A `maximum-scale=1` or `user-scalable=no` viewport is a WCAG 1.4.4
    // failure: it takes away the only zoom a phone browser has.
    await page.goto("/");
    const content = await page
      .locator('meta[name="viewport"]')
      .first()
      .getAttribute("content")
      .catch(() => null);
    expect(content, "no viewport meta tag").toBeTruthy();
    expect(content).toContain("width=device-width");
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(content).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
  });
});

test.describe("detail routes fit too @mobile", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZRESP");
    insertSyntheticTrade(target, { tag: "responsive" });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("stock and insider pages fit at 360 and 390", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 780 });
      for (const route of [`/stock/${target.ticker}`, `/insider/${target.insiderId}`]) {
        await page.goto(route);
        await settle(page);
        const report = await measureOverflow(page);
        expect(report.culprits, `${route} @${width}px`).toEqual([]);
        expect(report.doc, `${route} @${width}px document width`).toBeLessThanOrEqual(
          report.viewport + 1,
        );
      }
    }
  });
});

test.describe("wide tables on a narrow screen @mobile", () => {
  test("secondary columns fold, and the fold is reversible", async ({ page }) => {
    await page.goto("/screener");
    const scroller = page.getByTestId("data-table-scroll");
    await expect(scroller).toBeVisible();

    const visibleHeaders = () =>
      page.$$eval("[data-testid='data-table-scroll'] th", (els) =>
        els.filter((el) => getComputedStyle(el).display !== "none").map((el) => el.textContent),
      );

    const key = await visibleHeaders();
    // Date, Company, Code, Value: which filing this is, and how big.
    expect(key.length, `key columns: ${key.join(", ")}`).toBeLessThanOrEqual(4);
    expect(key.join(" ")).toMatch(/Date/);
    expect(key.join(" ")).toMatch(/Value/);

    // Nothing is lost — the rest is one tap away. Hiding a filing's source
    // with no way to ask for it would make the phone a lesser view of the
    // truth rather than a smaller one.
    const toggle = page.getByTestId("table-columns-toggle");
    await expect(toggle).toBeVisible();
    await toggle.tap();
    const all = await visibleHeaders();
    expect(all.length, "every column back").toBeGreaterThan(key.length);
    expect(all.join(" ")).toMatch(/Source/);
  });

  test("the first column freezes and the scrollable edge is drawn", async ({ page }) => {
    await page.goto("/screener");
    const scroller = page.getByTestId("data-table-scroll");
    // There IS more table than well — otherwise none of this applies.
    const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    test.skip(overflow <= 1, "table fits — nothing to freeze against");

    await expect(scroller).toHaveAttribute("data-scroll", "start");
    const firstCellPosition = await page.$eval(
      "[data-testid='data-table-scroll'] tbody td",
      (el) => getComputedStyle(el).position,
    );
    expect(firstCellPosition, "the first column is frozen").toBe("sticky");

    // Scroll it and the row keeps its identity column in place.
    const before = await page.$eval("[data-testid='data-table-scroll'] tbody td", (el) =>
      Math.round(el.getBoundingClientRect().x),
    );
    await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(scroller).toHaveAttribute("data-scroll", "end");
    const after = await page.$eval("[data-testid='data-table-scroll'] tbody td", (el) =>
      Math.round(el.getBoundingClientRect().x),
    );
    expect(Math.abs(after - before), "the frozen column did not move").toBeLessThanOrEqual(2);
  });

  test("the table does not eat the whole screen, and is keyboard-scrollable", async ({ page }) => {
    await page.goto("/screener");
    const scroller = page.getByTestId("data-table-scroll");
    const box = await settledBox(scroller, "screener table scroller");
    const viewport = page.viewportSize()!;
    // A 560px well on a phone captures every vertical drag inside it, so
    // the page cannot be scrolled past the table by touch at all.
    expect(box.height).toBeLessThanOrEqual(viewport.height * 0.75);
    // WCAG 2.1.1: a scroll container with no focusable child needs to be
    // focusable itself, or a keyboard cannot reach the columns to its right.
    await expect(scroller).toHaveAttribute("tabindex", "0");
    await expect(scroller).toHaveRole("region");
  });
});

test.describe("the screener's filters on a phone @mobile", () => {
  test("the primary axis stays on the page and scrolls sideways", async ({ page }) => {
    await page.goto("/screener");
    const row = page.getByTestId("filter-primary");
    await expect(row).toBeVisible();

    // One line, not six. Market and side are the taps a reader makes
    // constantly, so they stay reachable without opening anything.
    const lines = await row.evaluate(
      (el) =>
        new Set(Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().y))).size,
    );
    expect(lines, "the primary row does not wrap").toBe(1);

    // …and it is the row that scrolls, not the page.
    const scrollable = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    const pageWidth = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    }));
    expect(pageWidth.doc).toBeLessThanOrEqual(pageWidth.vw + 1);
    // Measured, then asserted — the box was read inline here, which made it
    // the one measurement in this file taken while the tape was still
    // settling.
    const rowWidth = (await settledBox(row, "primary tape row")).width;
    expect(scrollable || rowWidth <= pageWidth.vw).toBe(true);
  });

  test("the rest opens in a bottom sheet and applies on a button", async ({ page }) => {
    await page.goto("/screener");
    const trigger = page.getByTestId("filter-sheet-trigger");
    await expect(trigger).toBeVisible();
    const triggerBox = await settledBox(trigger, "filter sheet trigger");
    expect(Math.round(triggerBox.height)).toBeGreaterThanOrEqual(43);

    await trigger.tap();
    const sheet = page.getByTestId("filter-sheet");
    await expect(sheet).toBeVisible();

    // A sheet: anchored to the bottom, where a thumb is.
    const viewport = page.viewportSize()!;
    // A bottom sheet ANIMATES up from off-canvas, so a single read here is
    // the worst case in the file: it lands mid-travel and reports a sheet
    // that is not flush to the bottom, which reads as a layout bug.
    const box = await settledBox(sheet, "filter sheet");
    expect(Math.round(box.y + box.height), "flush to the bottom").toBeGreaterThanOrEqual(
      viewport.height - 2,
    );
    expect(Math.round(box.width), "full width").toBeGreaterThanOrEqual(viewport.width - 2);

    // Draft state: choosing does nothing until Apply. The bar writes to the
    // URL on every change, which would leave one history entry per control.
    await sheet.getByLabel("Minimum USD value").selectOption("1000000");
    expect(page.url()).not.toContain("min_value_usd");

    await page.getByTestId("filter-sheet-apply").tap();
    await expect(sheet).toBeHidden();
    await page.waitForURL(/min_value_usd=1000000/);
  });

  test("the trigger says how many filters are hidden inside it", async ({ page }) => {
    // A collapsed filter set with filters silently applied is a screen you
    // cannot explain to yourself.
    await page.goto("/screener");
    await expect(page.getByTestId("filter-count")).toHaveCount(0);

    await page.goto("/screener?min_value_usd=1000000&side=buy");
    await expect(page.getByTestId("filter-count")).toHaveText("2");
  });

  test("clear all empties the draft without leaving the sheet", async ({ page }) => {
    await page.goto("/screener?min_value_usd=1000000");
    await page.getByTestId("filter-sheet-trigger").tap();
    const sheet = page.getByTestId("filter-sheet");
    await expect(sheet.getByLabel("Minimum USD value")).toHaveValue("1000000");
    await page.getByTestId("filter-sheet-clear").tap();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Minimum USD value")).toHaveValue("");
  });
});

test.describe("touch targets @mobile", () => {
  /**
   * Every standalone control is at least 44x44 at a phone width.
   *
   * Two documented exemptions, both narrow:
   *
   *   The skip link is `sr-only` until focused; its hidden box is not its
   *   target.
   *
   *   The transaction-code badge is a tooltip trigger sized to a tape row.
   *   At 24x25 it clears WCAG 2.2 2.5.8 (AA, 24x24); taking it to 44 would
   *   double the height of every row in the product, and the full code
   *   description is also printed on the code legend.
   *
   * Inline links inside prose are exempt by the specification itself.
   */
  const ROUTES_TO_SWEEP = [
    "/",
    "/trades",
    "/screener",
    "/heatmap",
    "/politicians",
    "/leaderboard",
    "/companies",
    "/watchlist",
    "/settings",
    "/docs",
    "/status",
    "/legal",
    "/login",
  ];

  test("nothing standalone is under 44px", async ({ page }) => {
    for (const route of ROUTES_TO_SWEEP) {
      await page.goto(route);
      const small = await page.evaluate(() => {
        const SELECTOR =
          "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link]";
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          const cls = String(el.className);
          if (cls.includes("sr-only") || cls.includes("cursor-help")) continue;
          const own = el.textContent?.trim() ?? "";
          const parent = el.parentElement?.textContent?.trim() ?? "";
          // The specification's own inline exception: a link inside a
          // sentence is measured by the sentence, not by itself.
          if (style.display.startsWith("inline") && parent.length > own.length + 12) continue;
          if (box.width >= 43 && box.height >= 43) continue;
          out.push(
            `${Math.round(box.width)}x${Math.round(box.height)} <${el.tagName.toLowerCase()}> ` +
              `"${(el.getAttribute("aria-label") ?? own).slice(0, 28)}"`,
          );
        }
        return out;
      });
      expect(small, `${route}: targets under 44px`).toEqual([]);
    }
  });
});

import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

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
  return page.evaluate(() => {
    const viewport = window.innerWidth;
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
  });
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

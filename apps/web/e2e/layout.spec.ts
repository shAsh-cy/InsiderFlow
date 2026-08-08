import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * THE LEFT EDGE.
 *
 * Every app page keys to one vertical line: `--shell-gutter` from the start
 * of the content region. This spec is the thing that keeps it true — a
 * left-anchored layout is trivial to reintroduce `mx-auto` into, and the
 * regression is invisible on the page you were editing at the time.
 *
 * It asserts three separate things, because "looks aligned" is three
 * different failures:
 *   1. the gutter itself is inside the 32–40px band the design calls for;
 *   2. the first element of every page starts exactly on the region edge;
 *   3. the heading, the first card and the first table all start there too
 *      — an aligned heading over an inset card is still a broken edge.
 */

/** ±4px, as specified: sub-pixel layout rounding is not a design failure. */
const TOLERANCE = 4;

/** Every route the app shell owns, plus the standalone reference pages. */
const STATIC_ROUTES = [
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
];

async function readShellTokens(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const px = (name: string) => {
      // Custom properties resolve to their declared unit, so measure them
      // through a throwaway element rather than parsing rem by hand.
      const probe = document.createElement("div");
      probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name})`;
      document.body.appendChild(probe);
      const value = probe.getBoundingClientRect().width;
      probe.remove();
      return value;
    };
    return {
      gutter: px("--shell-gutter"),
      railInset: px("--shell-rail-inset"),
      raw: root.getPropertyValue("--shell-gutter").trim(),
    };
  });
}

/**
 * The x every element on the page must start on: the content region's own
 * left edge. `[data-content-region]` is an unpadded wrapper in every layout,
 * so its box edge IS the design's left edge.
 */
async function contentEdge(page: Page): Promise<number> {
  const region = page.locator("[data-content-region]").first();
  await expect(region).toBeAttached();
  const box = await region.boundingBox();
  if (!box) throw new Error("content region has no box");
  return box.x;
}

test.describe("left-anchored app layout", () => {
  test("the shell gutter is inside the 32–40px band on desktop", async ({ page }) => {
    await page.goto("/trades");
    const { gutter, railInset } = await readShellTokens(page);

    expect(gutter).toBeGreaterThanOrEqual(32);
    expect(gutter).toBeLessThanOrEqual(40);
    // The hanging rail must fit in the gutter with air to spare, or it
    // collides with the sidebar rule.
    expect(railInset).toBeLessThan(gutter);
  });

  test("no app page centres its content well", async ({ page }) => {
    for (const route of STATIC_ROUTES) {
      await page.goto(route);
      const centred = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]");
        if (!region) return "missing region";
        // Walk up to the page's outermost box, checking nothing on the way
        // has been re-centred. `margin-inline: auto` resolves to a computed
        // pixel margin, so compare the two sides rather than the keyword.
        let node: HTMLElement | null = region as HTMLElement;
        while (node && node !== document.body) {
          const s = getComputedStyle(node);
          const left = parseFloat(s.marginLeft);
          const right = parseFloat(s.marginRight);
          if (left > 1 && Math.abs(left - right) < 1) {
            return `${node.tagName}.${node.className} is centred (${left}px each side)`;
          }
          node = node.parentElement;
        }
        return null;
      });
      expect(centred, `${route} must not be centred`).toBeNull();
    }
  });

  test("the first content element starts on the shell gutter, on every route", async ({ page }) => {
    for (const route of STATIC_ROUTES) {
      await page.goto(route);
      const { gutter } = await readShellTokens(page);

      const measured = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]");
        if (!region) return null;
        const first = region.firstElementChild;
        if (!first) return null;
        const s = getComputedStyle(first);
        return {
          regionX: region.getBoundingClientRect().x,
          // The CONTENT edge, not the border-box edge. A hanging rail puts
          // its own rule out in the gutter on purpose; what has to land on
          // the design's left edge is the text it marks.
          firstX:
            first.getBoundingClientRect().x +
            parseFloat(s.borderLeftWidth) +
            parseFloat(s.paddingLeft),
          containerX: region.parentElement!.getBoundingClientRect().x,
          tag: first.tagName,
        };
      });

      expect(measured, `${route} has no content region`).not.toBeNull();

      // The gutter, measured: how far the content sits from the start of
      // whatever contains it.
      expect(
        Math.abs(measured!.regionX - measured!.containerX - gutter),
        `${route}: content region should sit ${gutter}px from its container`,
      ).toBeLessThanOrEqual(TOLERANCE);

      // …and the first thing on the page starts exactly there.
      expect(
        Math.abs(measured!.firstX - measured!.regionX),
        `${route}: first element <${measured!.tag}> should start on the region edge`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  test("every top-level block on the page shares one left edge", async ({ page }) => {
    for (const route of STATIC_ROUTES) {
      await page.goto(route);

      // Measured on the MARGIN box, so an element that deliberately hangs
      // into the gutter (the rail) is judged by where it was placed, not by
      // how far its own rule reaches back. Nested content is exempt on
      // purpose: a table inside a padded card is inset by that card, and
      // demanding otherwise would forbid cards from having padding.
      const strays = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]")!;
        const edge = region.getBoundingClientRect().x;
        const out: Array<{ tag: string; cls: string; at: number }> = [];
        for (const child of Array.from(region.children)) {
          const box = child.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          const placed = box.x - parseFloat(getComputedStyle(child).marginLeft);
          if (Math.abs(placed - edge) > 4) {
            out.push({
              tag: child.tagName,
              cls: typeof child.className === "string" ? child.className.slice(0, 60) : "",
              at: Math.round(placed - edge),
            });
          }
        }
        return out;
      });
      expect(strays, `${route}: blocks off the left edge`).toEqual([]);

      // The page heading specifically, wherever it is nested.
      const heading = page.locator("[data-content-region] h1").first();
      if ((await heading.count()) > 0) {
        const edge = await contentEdge(page);
        const box = await heading.boundingBox();
        expect(
          Math.abs(box!.x - edge),
          `${route}: h1 at ${box!.x} should sit on the left edge at ${edge}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  test("the hanging rail sits IN the gutter, not in the text column", async ({ page }) => {
    await page.goto("/trades");
    const edge = await contentEdge(page);
    const rail = page.locator("[data-content-region] .rail-bleed").first();
    const box = await rail.boundingBox();

    expect(box).not.toBeNull();
    // The rail's own box hangs left of the edge; the text it marks does not.
    expect(box!.x).toBeLessThan(edge);
    const heading = await page.locator("[data-content-region] h1").first().boundingBox();
    expect(Math.abs(heading!.x - edge)).toBeLessThanOrEqual(TOLERANCE);
  });

  test("auth screens are still allowed to centre", async ({ page }) => {
    await page.goto("/login");
    const centred = await page.evaluate(() => {
      const main = document.querySelector("#main")!;
      const s = getComputedStyle(main);
      return Math.abs(parseFloat(s.marginLeft) - parseFloat(s.marginRight)) < 1;
    });
    // The exemption is deliberate and narrow: one form, no column to scan.
    expect(centred).toBe(true);
  });
});

test.describe("left-anchored detail routes", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZLAYOUT");
    insertSyntheticTrade(target, { tag: "layout" });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("stock and insider pages key to the same edge", async ({ page }) => {
    for (const route of [`/stock/${target.ticker}`, `/insider/${target.insiderId}`]) {
      await page.goto(route);
      const { gutter } = await readShellTokens(page);
      const measured = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]")!;
        const first = region.firstElementChild!;
        const s = getComputedStyle(first);
        return {
          regionX: region.getBoundingClientRect().x,
          firstX:
            first.getBoundingClientRect().x +
            parseFloat(s.borderLeftWidth) +
            parseFloat(s.paddingLeft),
          containerX: region.parentElement!.getBoundingClientRect().x,
        };
      });
      expect(
        Math.abs(measured.regionX - measured.containerX - gutter),
        `${route}: gutter`,
      ).toBeLessThanOrEqual(TOLERANCE);
      expect(
        Math.abs(measured.firstX - measured.regionX),
        `${route}: first element on the edge`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

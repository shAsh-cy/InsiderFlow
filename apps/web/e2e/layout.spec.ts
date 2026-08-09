import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * LAYOUT v3. Rewritten from r4, which was rewritten from r3.
 *
 * Two rounds went past each other, and this file has to encode why so the
 * third correction is the last one.
 *
 * r3 pinned every page to the viewport's left edge, which left a dead strip
 * of paper down the right of any wide screen. r4 fixed that by centring the
 * whole frame — and centring the frame centred the CHROME with it, so at
 * 1920 the sidebar floated 250px in from the bezel and the application read
 * as an island sitting on a desktop rather than as the window it is.
 *
 * Both applied one rule to two things that want opposite treatment:
 *
 *   CHROME PINS. The masthead spans the viewport; the sidebar's left edge
 *   IS the screen's left edge. A window frame that floats is not a frame.
 *
 *   CONTENT IS FLUID. The region runs from (sidebar + gutter) to (viewport
 *   − gutter), with no cap. A tape, a table and a stat strip all get better
 *   with width.
 *
 *   PROSE IS THE EXCEPTION. A reading block caps at ~72ch keyed to the
 *   region's LEFT edge, and the right-hand whitespace there is the point.
 *
 * r4's frame-centring assertions are deleted rather than adjusted: they
 * asserted the opposite of the contract, and a test that has to be inverted
 * is a test that was encoding an implementation instead of a rule.
 */

/** ±4px, as specified: sub-pixel layout rounding is not a design failure. */
const TOLERANCE = 4;

/** Routes the sidebar shell owns — the content region is fluid on all of them. */
const APP_ROUTES = [
  "/trades",
  "/screener",
  "/companies",
  "/watchlist",
  "/heatmap",
  "/leaderboard",
  "/politicians",
  "/settings",
  "/design",
];

/**
 * Sidebar routes whose CONTENT deliberately stops short of the far gutter:
 * long-form reading blocks capped at a measure. Exempt from the dead-zone
 * check and from nothing else.
 */
const PROSE_ROUTES = ["/docs", "/docs/methodology"];

/** No sidebar, no chrome to pin against: a fluid shell with clamped padding. */
const STANDALONE_ROUTES = ["/", "/status", "/legal"];

const ALL_ROUTES = [...APP_ROUTES, ...PROSE_ROUTES, ...STANDALONE_ROUTES];

async function readShellTokens(page: Page) {
  return page.evaluate(() => {
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
      sidebar: px("--shell-sidebar"),
    };
  });
}

interface Geometry {
  viewport: number;
  headerWidth: number;
  headerBarLeft: number | null;
  sidebarLeft: number | null;
  regionLeft: number;
  regionWidth: number;
  /** Furthest right edge any top-level block on the page reaches. */
  contentRight: number;
  /** Anything imposing a fixed frame: capped and auto-margined. */
  framed: string | null;
}

async function readGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const header = document.querySelector("header")!;
    const bar = header.firstElementChild;
    const side = document.querySelector("aside.sticky");
    const region = document.querySelector("[data-content-region]")!;
    const rb = region.getBoundingClientRect();

    let contentRight = rb.x;
    for (const child of Array.from(region.children)) {
      const b = child.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      contentRight = Math.max(contentRight, b.right);
    }

    // A frame is a materially narrower box with roughly equal auto margins.
    // r4 had one on every page; v3 must have none anywhere.
    let framed: string | null = null;
    for (const el of Array.from(
      document.querySelectorAll("main, main > div, header > div, footer > div, [data-shell-frame]"),
    )) {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const ml = parseFloat(s.marginLeft);
      const mr = parseFloat(s.marginRight);
      if (ml > 8 && Math.abs(ml - mr) < 2 && b.width < viewport - 40) {
        framed = `${el.tagName}.${String(el.className).slice(0, 48)} width=${Math.round(b.width)} margin=${Math.round(ml)}`;
        break;
      }
    }

    return {
      viewport,
      headerWidth: header.getBoundingClientRect().width,
      headerBarLeft: bar ? bar.getBoundingClientRect().x : null,
      sidebarLeft: side ? side.getBoundingClientRect().x : null,
      regionLeft: rb.x,
      regionWidth: rb.width,
      contentRight,
      framed,
    };
  });
}

test.describe("chrome pins to the viewport", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`the masthead spans the screen and the sidebar starts at it, at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of APP_ROUTES) {
        await page.goto(route);
        const g = await readGeometry(page);

        expect(
          Math.round(g.headerWidth),
          `${route} @${width}: masthead should span the viewport`,
        ).toBeGreaterThanOrEqual(width - 1);

        // The bar's CONTENTS, not just its rule. r4 rode the contents on a
        // centred frame while the rule beneath them spanned the screen,
        // which is the visual tell that the two had come apart.
        expect(
          g.headerBarLeft,
          `${route} @${width}: the bar's contents start at the screen edge`,
        ).toBeLessThanOrEqual(TOLERANCE);

        expect(
          g.sidebarLeft,
          `${route} @${width}: sidebar left edge is the screen's left edge`,
        ).not.toBeNull();
        expect(
          Math.abs(g.sidebarLeft!),
          `${route} @${width}: sidebar at x=${g.sidebarLeft}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  }

  test("nothing anywhere imposes a fixed frame", async ({ page }) => {
    // The r4 failure mode, asserted directly: a capped, auto-margined box
    // around the application. Checked at 1920 where a 1408 frame would show
    // 256px of margin either side.
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const route of ALL_ROUTES) {
      await page.goto(route);
      const g = await readGeometry(page);
      expect(g.framed, `${route}: a frame reappeared`).toBeNull();
    }
  });
});

test.describe("content is fluid", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`the region reaches the far gutter at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of APP_ROUTES) {
        await page.goto(route);
        const g = await readGeometry(page);
        const { gutter, sidebar } = await readShellTokens(page);

        // Left: sidebar + one gutter.
        expect(
          Math.abs(g.regionLeft - (sidebar + gutter)),
          `${route} @${width}: region starts at ${Math.round(g.regionLeft)}, expected ${sidebar + gutter}`,
        ).toBeLessThanOrEqual(TOLERANCE);

        // Right: one gutter from the viewport, and no more. This is the
        // whole of "no cap" — a 1408 frame at 1920 would leave 288px here.
        expect(
          Math.abs(g.viewport - g.contentRight - gutter),
          `${route} @${width}: ${Math.round(g.viewport - g.contentRight)}px of dead paper on the right`,
        ).toBeLessThanOrEqual(8);
      }
    });
  }

  test("the region grows with the window rather than stopping", async ({ page }) => {
    // The property r4 bought with a cap and v3 gets for free: at 2560 the
    // content is genuinely wider, not the same width further from the edge.
    const widths = [1440, 1920, 2560];
    const measured: number[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/trades");
      measured.push((await readGeometry(page)).regionWidth);
    }
    for (let i = 1; i < measured.length; i += 1) {
      expect(
        measured[i]! - measured[i - 1]!,
        `region should widen from ${widths[i - 1]} to ${widths[i]}: ${measured.join(" → ")}`,
      ).toBeGreaterThan(400);
    }
  });

  test("prose caps at a measure and keeps the region's left edge", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const route of PROSE_ROUTES) {
      await page.goto(route);
      const g = await readGeometry(page);
      const { gutter, sidebar } = await readShellTokens(page);

      // Left edge: the same as every other app route.
      expect(
        Math.abs(g.regionLeft - (sidebar + gutter)),
        `${route}: prose starts on the region edge`,
      ).toBeLessThanOrEqual(TOLERANCE);

      // …and it deliberately does NOT reach the far gutter. A reading
      // block that ran to 1632px would be ~200 characters a line.
      const measure = g.contentRight - g.regionLeft;
      expect(measure, `${route}: measure is ${Math.round(measure)}px`).toBeLessThan(1100);
      expect(measure, `${route}: measure collapsed`).toBeGreaterThan(400);
    }
  });
});

test.describe("the standalone shell is fluid and even", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`landing gutters are equal and bounded at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const g = await readGeometry(page);
      const rightGutter = g.viewport - g.contentRight;

      expect(
        Math.abs(g.regionLeft - rightGutter),
        `landing @${width}: gutters ${Math.round(g.regionLeft)} / ${Math.round(rightGutter)}`,
      ).toBeLessThanOrEqual(8);

      // `clamp(24px, 6vw, 120px)` — tracks the window, stops at 120 so a
      // 2560px screen does not turn the page into a letterbox.
      expect(g.regionLeft, `landing @${width}: gutter too wide`).toBeLessThanOrEqual(130);
      expect(g.regionLeft, `landing @${width}: gutter too narrow`).toBeGreaterThanOrEqual(24);
    });
  }

  test("the landing hero keeps its 7/5 asymmetry across the fluid shell", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    const hero = await page.locator("[data-content-region] > section").first().boundingBox();
    const cols = await page.evaluate(() => {
      const section = document.querySelector("[data-content-region] > section")!;
      return Array.from(section.children).map((c) => {
        const b = c.getBoundingClientRect();
        return { x: Math.round(b.x), w: Math.round(b.width) };
      });
    });
    expect(cols.length, "the hero has two columns").toBe(2);
    expect(cols[1]!.x, "the tape sits to the right of the hero").toBeGreaterThan(
      cols[0]!.x + cols[0]!.w - 1,
    );
    expect(cols[0]!.w / hero!.width).toBeGreaterThan(0.5);
    expect(cols[0]!.w).toBeGreaterThan(cols[1]!.w);
  });
});

test.describe("composition inside the region", () => {
  // Two of these walk all fourteen routes and poll each one until it is at
  // rest. Under three concurrent projects that is a real amount of work,
  // and the default 30s budget is not generous for it.
  test.setTimeout(90_000);
  test("every top-level block shares one left edge", async ({ page }) => {
    for (const route of ALL_ROUTES) {
      // NOT `networkidle`: this product holds an open SSE connection on
      // several routes, so "no network for 500ms" can simply never arrive
      // and the wait becomes a timeout. The poll below is what settles the
      // measurement, and it is the instrument that belongs here anyway.
      await page.goto(route);

      // Measured on the MARGIN box, so an element that deliberately hangs
      // into the gutter (the rail) is judged by where it was placed, not by
      // how far its own rule reaches back. Nested content is exempt on
      // purpose: a table inside a padded card is inset by that card.
      //
      // POLLED, because the claim is about the page AT REST. Several of
      // these routes open with an entrance animation, and a block measured
      // mid-transform is at a position it is passing through rather than
      // one it was placed at — the same mistake r3 made reading
      // `getComputedStyle` during a 120ms fade. Under the full three-project
      // load this lost the race about one run in five.
      const measure = () =>
        page.evaluate(() => {
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
      await expect.poll(async () => (await measure()).length, { timeout: 8000 }).toBe(0);
      expect(await measure(), `${route}: blocks off the left edge`).toEqual([]);

      // `:visible`, not `.first()`: /design opens with a `sr-only` heading
      // above the showcase, and an off-screen box has no x to compare.
      const heading = page.locator("[data-content-region] h1:visible").first();
      if ((await heading.count()) > 0) {
        const g = await readGeometry(page);
        const box = await heading.boundingBox();
        expect(box, `${route}: visible h1 has no box`).not.toBeNull();
        expect(
          Math.abs(box!.x - g.regionLeft),
          `${route}: h1 at ${box!.x} should sit on the left edge at ${g.regionLeft}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  test("nothing inside the content region re-centres itself", async ({ page }) => {
    // r3's rule, kept verbatim and kept where it belongs: the BLOCKS may
    // not centre. Measured at 1920, where a stray `mx-auto` has real
    // surplus to split.
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const route of ALL_ROUTES) {
      await page.goto(route);
      // Polled for the same reason as the left-edge check above: the claim
      // is about the page at rest, and an entrance animation can put an
      // element momentarily where it was never placed.
      const centred = () =>
        page.evaluate(() => {
          const region = document.querySelector("[data-content-region]");
          if (!region) return ["missing region"];
          const out: string[] = [];
          const walk = (node: Element, depth: number) => {
            if (depth > 3) return;
            for (const child of Array.from(node.children)) {
              const el = child as HTMLElement;
              // True empty and error states are allowed to centre — one
              // object on the page and no column to scan. So are overlays.
              if (el.closest("[data-empty-state],[role='dialog'],[role='status']")) continue;
              const s = getComputedStyle(el);
              const left = parseFloat(s.marginLeft);
              const right = parseFloat(s.marginRight);
              if (left > 1 && Math.abs(left - right) < 1) {
                out.push(
                  `${el.tagName}.${String(el.className).slice(0, 50)} (${Math.round(left)}px each side)`,
                );
              }
              walk(child, depth + 1);
            }
          };
          walk(region, 1);
          return out;
        });
      await expect.poll(async () => (await centred()).length, { timeout: 8000 }).toBe(0);
      expect(await centred(), `${route}: content re-centred inside the region`).toEqual([]);
    }
  });

  test("the frame padding is 24px below 1024 and 32px above it", async ({ page }) => {
    for (const [width, expected] of [
      [360, 24],
      [768, 24],
      [1023, 24],
      [1024, 32],
      [1920, 32],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/trades");
      const { gutter, railInset } = await readShellTokens(page);
      expect(gutter, `--shell-gutter at ${width}`).toBe(expected);
      // The hanging rail has to fit in the gutter with air to spare, at
      // every width — r3 checked this at 1280 only.
      expect(railInset, `rail must fit inside the gutter at ${width}`).toBeLessThan(gutter);
    }
  });

  test("the hanging rail sits IN the gutter, not in the text column", async ({ page }) => {
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/trades");
      const g = await readGeometry(page);
      const rail = page.locator("[data-content-region] .rail-bleed").first();
      const box = await rail.boundingBox();

      expect(box, `no rail at ${width}`).not.toBeNull();
      expect(box!.x, `rail should hang left of the edge at ${width}`).toBeLessThan(g.regionLeft);
      expect(box!.x, `rail must not escape the viewport at ${width}`).toBeGreaterThanOrEqual(-1);
      const heading = await page.locator("[data-content-region] h1").first().boundingBox();
      expect(Math.abs(heading!.x - g.regionLeft)).toBeLessThanOrEqual(TOLERANCE);
    }
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

test.describe("detail routes key to the same edge", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    // Short prefix on purpose: the stock route truncates a ticker to 12
    // characters, so a longer fixture name resolves to a company that does
    // not exist and the page 404s for reasons unrelated to layout.
    target = createSyntheticCompany("ZZLAY");
    insertSyntheticTrade(target, { tag: "layout" });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("stock and insider pages start on the region edge and reach the gutter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const route of [`/stock/${target.ticker}`, `/insider/${target.insiderId}`]) {
      await page.goto(route);
      const g = await readGeometry(page);
      const { gutter, sidebar } = await readShellTokens(page);
      expect(
        Math.abs(g.regionLeft - (sidebar + gutter)),
        `${route}: left edge`,
      ).toBeLessThanOrEqual(TOLERANCE);
      expect(
        Math.abs(g.viewport - g.contentRight - gutter),
        `${route}: right gutter`,
      ).toBeLessThanOrEqual(8);
    }
  });

  test("/stock splits into record and rail at xl, and stacks below it", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/stock/${target.ticker}`);
    const wide = await page.evaluate(() => {
      const record = document.querySelector("[data-testid='stock-record']")!;
      const rail = document.querySelector("[data-testid='stock-rail']")!;
      const r = record.getBoundingClientRect();
      const a = rail.getBoundingClientRect();
      return { recordRight: r.right, railLeft: a.x, sameRow: Math.abs(r.y - a.y) < 4 };
    });
    expect(wide.railLeft, "the rail sits right of the record").toBeGreaterThan(
      wide.recordRight - 1,
    );
    expect(wide.sameRow, "record and rail start on the same line").toBe(true);

    // …and the tables get the whole region back. Their columns sum to
    // ~1016px: leaving them beside a 21rem rail made a table that fitted at
    // 1440 scroll at every width — a dead right zone traded for a hidden one.
    const tables = await page.evaluate(() => {
      const region = document.querySelector("[data-content-region]")!;
      const block = document.querySelector("[data-testid='stock-tables']")!;
      return {
        regionWidth: region.getBoundingClientRect().width,
        blockWidth: block.getBoundingClientRect().width,
      };
    });
    expect(
      tables.blockWidth / tables.regionWidth,
      "the record spans the region, not the column beside the rail",
    ).toBeGreaterThan(0.98);

    // Below xl it is one column, and the rail's figures still come BEFORE
    // the tables in reading order.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`/stock/${target.ticker}`);
    const narrow = await page.evaluate(() => {
      const record = document.querySelector("[data-testid='stock-record']")!;
      const rail = document.querySelector("[data-testid='stock-rail']")!;
      return {
        railTop: rail.getBoundingClientRect().y,
        recordTop: record.getBoundingClientRect().y,
      };
    });
    expect(narrow.railTop, "figures come before the record on a narrow screen").toBeLessThan(
      narrow.recordTop,
    );
  });
});

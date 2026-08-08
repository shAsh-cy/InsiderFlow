import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * LAYOUT EQUILIBRIUM (r4). Rewritten from r3's "the left edge".
 *
 * r3's contract was "nothing is ever centred", and this file enforced it by
 * walking from the content region up to <body> looking for equal margins.
 * That rule was too blunt: it produced a page pinned to the left bezel with
 * a dead strip of paper down the right at any width above ~1500px, and the
 * test that guarded it would now fail on the correct layout.
 *
 * The contract is now two rules, and keeping them apart is the whole point:
 *
 *   1. The SHELL is centred and capped at `--shell-max`. Above that cap the
 *      left edge stops moving — which is what r3 actually wanted, obtained by
 *      bounding the frame rather than by pinning it to x=0.
 *
 *   2. The BLOCKS inside it are not. Every top-level block on a page starts
 *      on the content region's left edge, and none of them re-centres itself.
 *
 * …plus a third thing r3 never checked and which is the real point of a
 * bounded frame: the width inside it has to be USED. A centred shell with a
 * 72rem column inside it has simply moved the dead zone rather than removed
 * it, so landing and /stock are measured for a dead right zone directly.
 *
 * Two of these are measured at more than one viewport on purpose. r3's whole
 * suite ran at 1280 and only ever exercised the >=1024 branch of every rule.
 */

/** ±4px, as specified: sub-pixel layout rounding is not a design failure. */
const TOLERANCE = 4;

/** Every route the app shell owns, plus the standalone reference pages. */
const STATIC_ROUTES = [
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
];

/**
 * Pages that are a single column of prose and cap at a reading measure. A
 * right-hand margin on these is intentional whitespace, so they are exempt
 * from the dead-zone check and from nothing else.
 */
const PROSE_ROUTES = new Set(["/docs", "/docs/methodology", "/legal", "/status"]);

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
      max: px("--shell-max"),
      pad: px("--shell-pad"),
      gutter: px("--shell-gutter"),
      railInset: px("--shell-rail-inset"),
      sidebar: px("--shell-sidebar"),
    };
  });
}

/** The frame's box, its content box, and the region inside it. */
async function readFrame(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector("[data-shell-frame]");
    const region = document.querySelector("[data-content-region]");
    if (!frame || !region) return null;
    const fb = frame.getBoundingClientRect();
    const fs = getComputedStyle(frame);
    const rb = region.getBoundingClientRect();
    // The deepest right edge any top-level block on the page reaches.
    let contentRight = rb.x;
    for (const child of Array.from(region.children)) {
      const b = child.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      contentRight = Math.max(contentRight, b.right);
    }
    return {
      viewport: window.innerWidth,
      frameLeft: fb.x,
      frameRight: window.innerWidth - fb.right,
      frameWidth: fb.width,
      innerLeft: fb.x + parseFloat(fs.paddingLeft),
      innerRight: fb.right - parseFloat(fs.paddingRight),
      padLeft: parseFloat(fs.paddingLeft),
      padRight: parseFloat(fs.paddingRight),
      regionLeft: rb.x,
      regionWidth: rb.width,
      contentRight,
    };
  });
}

test.describe("the shell is centred", () => {
  // 1440 sits below the 88rem cap (the frame fills the viewport minus its
  // padding); 1920 sits above it (the cap bites and the surplus is split).
  // Both are asserted because they are two different code paths through the
  // same rule, and r3's suite would have passed while failing either.
  for (const width of [1440, 1920]) {
    test(`the frame is horizontally centred at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of STATIC_ROUTES) {
        await page.goto(route);
        const frame = await readFrame(page);
        expect(frame, `${route} has no [data-shell-frame]`).not.toBeNull();
        expect(
          Math.abs(frame!.frameLeft - frame!.frameRight),
          `${route} @${width}: frame gutters are ${Math.round(frame!.frameLeft)} / ${Math.round(frame!.frameRight)}`,
        ).toBeLessThanOrEqual(8);
      }
    });
  }

  test("the frame is capped at --shell-max and stops growing above it", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/trades");
    const { max } = await readShellTokens(page);
    const wide = await readFrame(page);
    expect(wide!.frameWidth).toBeLessThanOrEqual(max + 1);
    expect(Math.abs(wide!.frameWidth - max)).toBeLessThanOrEqual(1);

    // …and the left edge is the same distance from the content at 2560 as at
    // 1920, which is the property that made bounding the frame worth doing.
    await page.setViewportSize({ width: 2560, height: 900 });
    await page.goto("/trades");
    const wider = await readFrame(page);
    expect(wider!.frameWidth).toBeLessThanOrEqual(max + 1);
    expect(Math.abs(wider!.regionWidth - wide!.regionWidth)).toBeLessThanOrEqual(1);
  });

  test("the frame padding is 16px below 640 and 24px above it", async ({ page }) => {
    for (const [width, expected] of [
      [360, 16],
      [390, 16],
      [639, 16],
      [640, 24],
      [1024, 24],
      [1920, 24],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/trades");
      const { pad, gutter, railInset } = await readShellTokens(page);
      const frame = await readFrame(page);
      expect(pad, `--shell-pad at ${width}`).toBe(expected);
      expect(Math.round(frame!.padLeft), `frame padding-left at ${width}`).toBe(expected);
      expect(Math.round(frame!.padRight), `frame padding-right at ${width}`).toBe(expected);

      // The hanging rail has to fit in the space to the left of the content
      // with air to spare, at EVERY width. r3 checked this at 1280 only, and
      // 1rem of rail inside 16px of padding would have gone unnoticed.
      expect(railInset, `rail inset must fit inside pad+gutter at ${width}`).toBeLessThan(
        pad + gutter,
      );
    }
  });
});

test.describe("blocks inside the shell are not centred", () => {
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
        const frame = await readFrame(page);
        const box = await heading.boundingBox();
        expect(
          Math.abs(box!.x - frame!.regionLeft),
          `${route}: h1 at ${box!.x} should sit on the left edge at ${frame!.regionLeft}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  test("nothing inside the content region re-centres itself", async ({ page }) => {
    // Measured at 1920, where a stray `mx-auto` has real surplus to split.
    // r3's guard walked UP to <body> and would now flag the shell's own
    // (correct) centring; this walks DOWN from the region, which is the
    // only place the rule was ever meant to apply.
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const route of STATIC_ROUTES) {
      await page.goto(route);
      const centred = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]");
        if (!region) return ["missing region"];
        const out: string[] = [];
        const walk = (node: Element, depth: number) => {
          if (depth > 3) return;
          for (const child of Array.from(node.children)) {
            const el = child as HTMLElement;
            // True empty and error states are allowed to centre — one
            // object on the page and no column to scan. So are overlays,
            // which are not part of the page's column at all.
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
      expect(centred, `${route}: content re-centred inside the shell`).toEqual([]);
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

  test("the hanging rail sits IN the gutter, not in the text column", async ({ page }) => {
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/trades");
      const frame = await readFrame(page);
      const rail = page.locator("[data-content-region] .rail-bleed").first();
      const box = await rail.boundingBox();

      expect(box, `no rail at ${width}`).not.toBeNull();
      // The rail's own box hangs left of the edge; the text it marks does not.
      expect(box!.x, `rail should hang left of the edge at ${width}`).toBeLessThan(
        frame!.regionLeft,
      );
      // …and it never reaches out past the frame, which would clip it.
      expect(box!.x, `rail must not escape the frame at ${width}`).toBeGreaterThanOrEqual(
        frame!.frameLeft - 1,
      );
      const heading = await page.locator("[data-content-region] h1").first().boundingBox();
      expect(Math.abs(heading!.x - frame!.regionLeft)).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

test.describe("the width inside the frame is used", () => {
  // The failure a centred shell invites: cap the content at a measure inside
  // an already-capped frame and the dead zone comes straight back, one level
  // down. Landing and /stock are the two pages the brief names.
  for (const width of [1280, 1440, 1920]) {
    test(`landing has no dead right zone at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const frame = await readFrame(page);
      expect(
        frame!.innerRight - frame!.contentRight,
        `landing @${width}: ${Math.round(frame!.innerRight - frame!.contentRight)}px of dead paper on the right`,
      ).toBeLessThanOrEqual(8);
      // …and the region itself spans the frame, rather than the content
      // merely reaching across a narrow region.
      expect(frame!.regionWidth / (frame!.innerRight - frame!.innerLeft)).toBeGreaterThanOrEqual(
        0.9,
      );
    });
  }

  test("every non-prose app route fills the region beside the sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    for (const route of STATIC_ROUTES) {
      if (PROSE_ROUTES.has(route)) continue;
      await page.goto(route);
      const frame = await readFrame(page);
      const { sidebar } = await readShellTokens(page);
      const available = frame!.innerRight - frame!.innerLeft - sidebar;
      expect(
        frame!.regionWidth / available,
        `${route}: region is ${Math.round(frame!.regionWidth)} of ${Math.round(available)} available`,
      ).toBeGreaterThanOrEqual(0.9);
      expect(
        frame!.innerRight - frame!.contentRight,
        `${route}: dead right zone`,
      ).toBeLessThanOrEqual(8);
    }
  });

  test("landing and /stock become two columns once there is width to divide", async ({ page }) => {
    // The composition rule, asserted structurally rather than by eye: the
    // hero and the tape sit side by side, and the stock rail sits beside the
    // record — same top, different left edges.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    const hero = await page.locator("[data-content-region] > section").first().boundingBox();
    const heroCols = await page.evaluate(() => {
      const section = document.querySelector("[data-content-region] > section")!;
      return Array.from(section.children).map((c) => {
        const b = c.getBoundingClientRect();
        return { x: Math.round(b.x), w: Math.round(b.width) };
      });
    });
    expect(heroCols.length, "landing hero should have two columns").toBe(2);
    expect(heroCols[1]!.x, "the tape sits to the right of the hero").toBeGreaterThan(
      heroCols[0]!.x + heroCols[0]!.w - 1,
    );
    // 7/12 vs 5/12, allowing for the gap.
    expect(heroCols[0]!.w / hero!.width).toBeGreaterThan(0.5);
    expect(heroCols[0]!.w).toBeGreaterThan(heroCols[1]!.w);
  });
});

test.describe("detail routes key to the same edge", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    // Short prefix on purpose: the stock route truncates a ticker to 12
    // characters, so a longer fixture name resolves to a company that does
    // not exist and the page 404s for reasons that have nothing to do with
    // layout. `ZZLAY` + a five-digit suffix is ten.
    target = createSyntheticCompany("ZZLAY");
    insertSyntheticTrade(target, { tag: "layout" });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("stock and insider pages start on the region edge", async ({ page }) => {
    for (const route of [`/stock/${target.ticker}`, `/insider/${target.insiderId}`]) {
      await page.goto(route);
      const frame = await readFrame(page);
      const measured = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]")!;
        const first = region.firstElementChild!;
        const s = getComputedStyle(first);
        return {
          firstX:
            first.getBoundingClientRect().x +
            parseFloat(s.borderLeftWidth) +
            parseFloat(s.paddingLeft),
        };
      });
      expect(
        Math.abs(measured.firstX - frame!.regionLeft),
        `${route}: first element on the edge`,
      ).toBeLessThanOrEqual(TOLERANCE);
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

    // …and the tables get the whole frame back. The insider-trade table's
    // columns sum to ~1016px: beside a 21rem rail the main column is 732px
    // at 1920, so leaving them there would trade a dead right zone for a
    // hidden one — a table that fits at 1440 scrolling at every width.
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
      "the record spans the frame, not the column beside the rail",
    ).toBeGreaterThan(0.98);

    // Below xl it is one column, and — the part that matters — the rail's
    // figures still come BEFORE the tables in reading order.
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

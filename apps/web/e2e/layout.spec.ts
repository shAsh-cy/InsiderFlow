import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * LAYOUT v3.1 — ONE LEFT EDGE PER SHELL. Rewritten from v3 (r5), which was
 * rewritten from r4, which was rewritten from r3.
 *
 * This file has to encode WHY, so that the seventh correction is not
 * invited.
 *
 * v3 got the two halves right and then let them argue with each other.
 * CHROME PINS said the masthead spans the viewport and the sidebar's left
 * edge is the screen's left edge; CONTENT IS FLUID said the page starts at
 * the content gutter. Both are defensible. Having both on one screen is
 * not: it put the brand at x≈24 above a hero that started at 77, and a
 * page heading that started at 256 — two competing left edges, which is
 * exactly what was reported ("the icon is at the extreme left and the
 * content below has gaps").
 *
 * The fix is NOT to drag the content back out to the bezel. That was r3,
 * and it cost the right-hand gutter. It is to make the chrome share the
 * content's edges:
 *
 *   LANDING. The masthead's inner container is the same shell as the hero
 *   — the same padding token, not a second value that happens to agree —
 *   so the logo's left edge and the H1's left edge are one number.
 *
 *   APP ROUTES. The SIDEBAR owns product identity (shadcn/ui's
 *   SidebarHeader is documented as the place for branding; Catalyst,
 *   GitHub, Linear, Slack and Vercel all put the mark in the corner of the
 *   sidebar), so the brand moves there and the masthead becomes an action
 *   bar running from the sidebar's right edge to the content's right edge.
 *   Nothing in the top bar claims an edge of its own, because there is
 *   nothing left up there that could.
 *
 * Chrome still pins — the sidebar's left edge is still x=0, and it now
 * runs the full height of the viewport so the mark sits in the corner of
 * the window rather than floating in a bar above it. Content is still
 * fluid, prose is still the one exception, and r3's composition rules
 * still stand. Those tests are kept verbatim; what is deleted is the set
 * that asserted the masthead's CONTENTS start at the bezel, because that
 * is the assertion that was wrong.
 */

/**
 * ── r7 AMENDMENT: THE GUTTER CONTRACT, AND THE FOUR CORRECTIONS ────────
 *
 * The gutter assertions below are the one part of this file that has been
 * rewritten rather than extended, because the gutter contract itself
 * changed. The full history belongs here, in the file that enforces it, so
 * that an eighth revision is not invited to guess:
 *
 *   r4 — LEFT-HUG. Every page pinned to the viewport's left edge. Rejected
 *        on sight: "tons of space on the right".
 *   r5 — CENTRED SHELL. The whole frame centred at 88rem, which centred the
 *        CHROME with it: at 1920 the sidebar floated 250px in from the
 *        bezel and the application read as an island on a desktop.
 *   r6 — UNIFIED EDGE. Chrome pins, content is fluid, and the two share one
 *        left edge: brand.left − heroH1.left = 0 at 1280/1440/1920. That is
 *        the property this round must not lose, and the assertions for it
 *        are UNCHANGED below.
 *   r7 — FLUID TIGHTER GUTTER + A DEFINED BAR. The gutter becomes one
 *        token, `clamp(24px, 6.25vw - 56px, 64px)`, shared by the landing
 *        shell, the app shell's content well and the masthead's inner
 *        container: 24px at 1280, 34 at 1440, 64 at 1920, replacing the
 *        landing's 77/86/115 and the app shell's 32px step. And the
 *        masthead gains an always-present ground and hairline, so the brand
 *        no longer floats on the page at scrollTop=0.
 *
 * What changed is the NUMBER and where it comes from. The edges are still
 * unified, and there is still no separate brand edge and no brand pinned to
 * the bezel above inset content — those are the two failure modes this
 * project has already paid for twice, and the tests for them stay.
 */

/** ±4px, as specified: sub-pixel layout rounding is not a design failure. */
const TOLERANCE = 4;

/**
 * The gutter this file expects at each desktop width, from
 * `clamp(24px, 6.25vw - 56px, 64px)`. Written out rather than recomputed,
 * so the test states the contract instead of restating the formula: a typo
 * in the CSS that still parses would agree with a recomputed expectation
 * and disagree with these.
 */
const EXPECTED_GUTTER: Record<number, number> = { 1280: 24, 1440: 34, 1920: 64 };

/**
 * ±1px for the alignments this round exists to fix. These are the claims
 * that were violated by 53–296px, so a loose tolerance here would let the
 * bug back in while the suite stayed green.
 */
const EXACT = 1;

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
  /** The masthead's inner container — the thing that holds the controls. */
  barLeft: number;
  barRight: number;
  /** The furthest right edge any masthead control reaches. */
  controlsRight: number;
  sidebarLeft: number | null;
  sidebarRight: number | null;
  /** Where the brand is actually mounted and drawn. */
  brandHost: "masthead" | "sidebar" | "drawer" | "other" | "none";
  brandLeft: number | null;
  /** The content region's BOX — its right edge is the far gutter. */
  regionLeft: number;
  regionRight: number;
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
    const bar = header.querySelector(".masthead-shell") ?? header.firstElementChild!;
    const side = document.querySelector("aside.sticky");
    const region = document.querySelector("[data-content-region]")!;
    const rb = region.getBoundingClientRect();
    const bb = bar.getBoundingClientRect();

    /** Drawn, not merely present: `display:none` has no edges to align. */
    const drawn = (el: Element | null) => Boolean(el && el.getClientRects().length > 0);

    let controlsRight = bb.left;
    for (const child of Array.from(bar.children)) {
      const b = child.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      controlsRight = Math.max(controlsRight, b.right);
    }

    const brand = Array.from(document.querySelectorAll("[data-brand]")).find(drawn) ?? null;
    const brandHost = !brand
      ? "none"
      : brand.closest("header")
        ? "masthead"
        : brand.closest("aside")
          ? "sidebar"
          : brand.closest("[data-testid='nav-drawer']")
            ? "drawer"
            : "other";

    let contentRight = rb.x;
    for (const child of Array.from(region.children)) {
      const b = child.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      contentRight = Math.max(contentRight, b.right);
    }

    // A frame is a materially narrower box with roughly equal auto margins.
    // r4 had one on every page; nothing since is allowed one anywhere.
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
      barLeft: bb.left,
      barRight: bb.right,
      controlsRight,
      sidebarLeft: side ? side.getBoundingClientRect().x : null,
      sidebarRight: side ? side.getBoundingClientRect().right : null,
      brandHost,
      brandLeft: brand ? brand.getBoundingClientRect().x : null,
      regionLeft: rb.x,
      regionRight: rb.right,
      regionWidth: rb.width,
      contentRight,
      framed,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════
   THE r6 CONTRACT — one left edge per shell
   ══════════════════════════════════════════════════════════════════════ */

test.describe("the landing: the masthead is the hero's own shell", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`the logo and the hero start on one x at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const g = await readGeometry(page);

      // The reported bug, measured directly. Before r6 this was 53px at
      // 1280, 62 at 1440 and 91 at 1920 — the brand pinned to the bezel
      // while the hero started at the fluid shell's margin.
      expect(g.brandHost, `the landing has no sidebar, so the brand is up top`).toBe("masthead");
      const h1 = await page.locator("[data-content-region] h1:visible").first().boundingBox();
      expect(h1, "the hero heading has no box").not.toBeNull();
      expect(
        Math.abs(g.brandLeft! - h1!.x),
        `@${width}: logo at ${Math.round(g.brandLeft!)}, hero H1 at ${Math.round(h1!.x)}`,
      ).toBeLessThanOrEqual(EXACT);

      // …and the other end of the same bar. `lg:pe-8` used to run the
      // controls 45–83px past the content's right edge, which is the same
      // failure seen from the other side.
      expect(
        Math.abs(g.controlsRight - g.regionRight),
        `@${width}: controls end at ${Math.round(g.controlsRight)}, content at ${Math.round(g.regionRight)}`,
      ).toBeLessThanOrEqual(EXACT);
    });
  }

  for (const width of [1280, 1440, 1920]) {
    test(`the footer stands on the hero's left edge at ${width}`, async ({ page }) => {
      // The third edge on this page, and the one a footer most easily
      // loses: it sits inside the same content region as the hero, so it
      // has nothing of its own to keep in sync.
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const h1 = await page.locator("[data-content-region] h1:visible").first().boundingBox();
      const footer = await page.locator("[data-content-region] footer").boundingBox();
      expect(footer, "the landing has a footer").not.toBeNull();
      expect(
        Math.abs(footer!.x - h1!.x),
        `@${width}: footer at ${Math.round(footer!.x)}, hero at ${Math.round(h1!.x)}`,
      ).toBeLessThanOrEqual(EXACT);
      // …and it reaches the far gutter, like every other block here.
      const g = await readGeometry(page);
      expect(
        Math.abs(footer!.x + footer!.width - g.regionRight),
        `@${width}: footer right edge`,
      ).toBeLessThanOrEqual(EXACT);
    });
  }

  test("the bar takes the shell's own padding token, not a copy of it", async ({ page }) => {
    // Two `clamp()`s that agree today are two `clamp()`s that can stop
    // agreeing. The alignment above is only durable if both sides read the
    // same custom property, so assert that they do.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    const pads = await page.evaluate(() => {
      const bar = document.querySelector(".masthead-shell")!;
      const shell = document.querySelector("main .shell-fluid, main.shell-fluid")!;
      return {
        bar: getComputedStyle(bar).paddingLeft,
        shell: getComputedStyle(shell).paddingLeft,
      };
    });
    expect(pads.bar, `bar ${pads.bar} vs shell ${pads.shell}`).toBe(pads.shell);
  });
});

test.describe("app routes: the sidebar owns identity, the bar owns actions", () => {
  for (const width of [1280, 1440, 1920]) {
    test(`the brand is in the sidebar and the bar keys to the content at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of APP_ROUTES) {
        await page.goto(route);

        // DOM containment, not just position: the mark belongs to the
        // navigation column, which is what makes it stop competing with
        // the page's own heading for the left edge.
        await expect(
          page.locator("aside [data-brand]"),
          `${route} @${width}: the brand lives in the sidebar`,
        ).toBeVisible();
        expect(
          await page.locator("header [data-brand]:visible").count(),
          `${route} @${width}: nothing in the masthead may claim a brand edge`,
        ).toBe(0);

        const g = await readGeometry(page);
        expect(g.brandHost, `${route} @${width}: brand host`).toBe("sidebar");

        // The action cluster ends where the content ends.
        expect(
          Math.abs(g.controlsRight - g.regionRight),
          `${route} @${width}: controls end at ${Math.round(g.controlsRight)}, content at ${Math.round(g.regionRight)}`,
        ).toBeLessThanOrEqual(EXACT);

        // …and begins where the content begins, because the bar's box
        // starts at the sidebar's right edge and then takes the same
        // gutter the content well does.
        expect(
          Math.abs(g.barLeft - (g.sidebarRight ?? 0)),
          `${route} @${width}: bar starts at ${Math.round(g.barLeft)}, sidebar ends at ${Math.round(g.sidebarRight ?? 0)}`,
        ).toBeLessThanOrEqual(EXACT);
      }
    });
  }

  test("the first content block sits on the content region's left edge", async ({ page }) => {
    // The other half of "one left edge": with the brand gone from the bar,
    // the only left edge left on an app screen is this one.
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of [...APP_ROUTES, ...PROSE_ROUTES]) {
      await page.goto(route);
      const g = await readGeometry(page);
      const first = await page.evaluate(() => {
        const region = document.querySelector("[data-content-region]")!;
        for (const child of Array.from(region.children)) {
          const b = child.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) continue;
          // Margin box: a block that deliberately hangs its rule into the
          // gutter is judged by where it was PLACED.
          return b.x - parseFloat(getComputedStyle(child).marginLeft);
        }
        return null;
      });
      expect(first, `${route}: no visible content block`).not.toBeNull();
      expect(
        Math.abs(first! - g.regionLeft),
        `${route}: first block at ${Math.round(first!)}, region at ${Math.round(g.regionLeft)}`,
      ).toBeLessThanOrEqual(EXACT);
    }
  });

  test("the sidebar rises to the top of the window and its brand is not a nav state", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/trades");
    const side = await page.locator("aside.sticky").boundingBox();
    expect(side!.y, "the sidebar starts at the top of the viewport").toBeLessThanOrEqual(TOLERANCE);
    expect(side!.height, "the sidebar runs the height of the window").toBeGreaterThan(800);

    // The r3 rule survives the move: three signals mean "you are here" and
    // the brand gets none of them, or it reads as a stuck highlight again.
    const brand = await page.locator("aside [data-brand]").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        current: el.getAttribute("aria-current"),
        rule: s.borderLeftStyle === "none" ? 0 : parseFloat(s.borderLeftWidth),
        ground: s.backgroundColor,
      };
    });
    expect(brand.current, "the brand is never current").toBeNull();
    expect(brand.rule, "the brand carries no accent rule").toBe(0);
    expect(brand.ground, "the brand carries no tinted ground").toBe("rgba(0, 0, 0, 0)");
  });

  test("the active nav item still carries aria-current AND a drawn accent bar", async ({
    page,
  }) => {
    for (const route of ["/trades", "/leaderboard", "/settings"]) {
      await page.goto(route);
      const current = page.locator("aside nav [aria-current='page']");
      if (route === "/settings") {
        // Settings is reached from the masthead, not the index — nothing in
        // the sidebar owns it, and nothing may pretend to.
        await expect(current, "no sidebar item owns /settings").toHaveCount(0);
        continue;
      }
      await expect(current, `${route}: exactly one current item`).toHaveCount(1);
      await expect(current).toHaveAttribute("href", route);
      const mark = await current.evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: parseFloat(s.borderLeftWidth), colour: s.borderLeftColor };
      });
      expect(mark.width, `${route}: the accent bar has width`).toBeGreaterThan(0);
      expect(mark.colour, `${route}: the accent bar is drawn`).not.toBe("rgba(0, 0, 0, 0)");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   WHAT v3 GOT RIGHT AND r6 KEEPS
   ══════════════════════════════════════════════════════════════════════ */

test.describe("chrome still pins to the viewport", () => {
  // One test per width, not one test walking all three: 27 page loads in a
  // 30s budget is a timeout, and a timeout says nothing about the layout.
  for (const width of [1280, 1440, 1920]) {
    test(`the sidebar's left edge is the screen's left edge at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of APP_ROUTES) {
        await page.goto(route);
        const g = await readGeometry(page);
        expect(g.sidebarLeft, `${route} @${width}: no sidebar`).not.toBeNull();
        expect(
          Math.abs(g.sidebarLeft!),
          `${route} @${width}: sidebar at x=${g.sidebarLeft}`,
        ).toBeLessThanOrEqual(TOLERANCE);
        // The bar reaches the far bezel: it is chrome on that side.
        expect(
          Math.abs(g.viewport - g.barRight),
          `${route} @${width}: the bar stops ${Math.round(g.viewport - g.barRight)}px short`,
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
    test(`landing gutters are equal and measure the r7 value at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const g = await readGeometry(page);
      const rightGutter = g.viewport - g.contentRight;

      expect(
        Math.abs(g.regionLeft - rightGutter),
        `landing @${width}: gutters ${Math.round(g.regionLeft)} / ${Math.round(rightGutter)}`,
      ).toBeLessThanOrEqual(8);

      // AMENDED in r7 — see the history block at the top of this file.
      // r6 asserted only a range (24–130), which is how 77/86/115 passed
      // for a round while the page visibly floated inside its own window.
      // A range is the wrong instrument for a number the design states
      // exactly, so this asserts the number.
      expect(
        Math.round(g.regionLeft),
        `landing @${width}: gutter should be ${EXPECTED_GUTTER[width]}px`,
      ).toBe(EXPECTED_GUTTER[width]);
    });
  }

  test("the gutter is one token, and every shell reads it", async ({ page }) => {
    // The property the number depends on. r6 kept the landing's margin and
    // the masthead's padding in step by hand, as two `clamp()`s that agreed;
    // two values that agree today are two values that can stop agreeing, and
    // the brand-to-hero alignment is what breaks when they do.
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/");
      const landing = await page.evaluate(() => {
        const bar = document.querySelector(".masthead-shell")!;
        const shell = document.querySelector("main.shell-fluid, main .shell-fluid")!;
        return {
          bar: getComputedStyle(bar).paddingLeft,
          shell: getComputedStyle(shell).paddingLeft,
        };
      });
      expect(landing.bar, `landing @${width}: bar ${landing.bar} vs shell ${landing.shell}`).toBe(
        landing.shell,
      );
      expect(Math.round(parseFloat(landing.shell))).toBe(EXPECTED_GUTTER[width]);

      await page.goto("/trades");
      const app = await page.evaluate(() => {
        const bar = document.querySelector(".masthead-shell")!;
        const well = document.querySelector("main.shell-content")!;
        return {
          bar: getComputedStyle(bar).paddingLeft,
          well: getComputedStyle(well).paddingLeft,
        };
      });
      expect(app.bar, `app @${width}: bar ${app.bar} vs well ${app.well}`).toBe(app.well);
      // The same number as the landing's, not merely a number of its own:
      // the app shell used to step 24 → 32 at 1024 and stop there.
      expect(Math.round(parseFloat(app.well))).toBe(EXPECTED_GUTTER[width]);
    }
  });

  test("the masthead is a bar at rest, not a floating brand", async ({ page }) => {
    // r7's other half. r6 gave the bar no ground and no rule until
    // something scrolled under it, which left the landing's brand sitting
    // on the page with nothing containing it — and on an app route it meant
    // the line across the top of the window stopped dead at the sidebar's
    // right edge, because the sidebar's own header rule WAS drawn.
    for (const [route, scheme] of [
      ["/", "dark"],
      ["/", "light"],
      ["/trades", "dark"],
      ["/trades", "light"],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(route);
      const bar = await page.evaluate(() => {
        const el = document.querySelector("[data-masthead]")!;
        const s = getComputedStyle(el);
        const alpha = (value: string) => {
          const m = value.match(/[\d.]+\)$/);
          return value.includes("rgba") || value.includes("/") ? parseFloat(m?.[0] ?? "1") : 1;
        };
        return {
          scrolled: el.getAttribute("data-scrolled"),
          bg: s.backgroundColor,
          bgAlpha: alpha(s.backgroundColor),
          border: s.borderBottomColor,
          borderWidth: parseFloat(s.borderBottomWidth),
          pageBg: getComputedStyle(document.body).backgroundColor,
        };
      });

      expect(bar.scrolled, `${route} ${scheme}: at rest`).toBe("false");
      // A ground: present, and not the page's own — otherwise there is no
      // bar, only a strip of page with a line under it.
      expect(bar.bgAlpha, `${route} ${scheme}: the bar has no ground`).toBeGreaterThan(0);
      expect(bar.bg, `${route} ${scheme}: the bar is the page`).not.toBe(bar.pageBg);
      // …and an edge, drawn, at rest.
      expect(bar.border, `${route} ${scheme}: no hairline at rest`).not.toBe("rgba(0, 0, 0, 0)");
      expect(bar.borderWidth, `${route} ${scheme}: hairline has no width`).toBeGreaterThan(0);
    }
    await page.emulateMedia({ colorScheme: null });
  });

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
        // /stock composes its heading beside a symbol tile, so the BLOCK is
        // on the edge and the heading is inset by the tile — checked above.
        if (!route.startsWith("/stock")) {
          expect(
            Math.abs(box!.x - g.regionLeft),
            `${route}: h1 at ${box!.x} should sit on the left edge at ${g.regionLeft}`,
          ).toBeLessThanOrEqual(TOLERANCE);
        }
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

  test("the gutter holds its floor, then opens with the window", async ({ page }) => {
    // AMENDED in r7 — see the history block at the top of this file. This
    // used to assert a two-step ladder (24 below 1024, 32 above), which
    // stopped growing at exactly the widths where there was room to grow.
    // The curve is `clamp(24px, 6.25vw - 56px, 64px)`, and the shape of it
    // is the point: pinned to the floor while width is scarce, opening
    // only once the screen has surplus, capped so a 2560px screen does not
    // become a letterbox.
    for (const [width, expected] of [
      [360, 24],
      [768, 24],
      [1023, 24],
      [1024, 24],
      [1280, 24],
      [1440, 34],
      [1920, 64],
      [2560, 64],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/trades");
      const { gutter, railInset } = await readShellTokens(page);
      expect(Math.round(gutter), `--shell-gutter at ${width}`).toBe(expected);
      // The hanging rail has to fit in the gutter with air to spare, at
      // every width — r3 checked this at 1280 only. It is tightest at the
      // floor, where 20px of rail sits in 24px of gutter.
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
      // …and the bar above them ends on the same right edge.
      expect(
        Math.abs(g.controlsRight - g.regionRight),
        `${route}: masthead controls off the content's right edge`,
      ).toBeLessThanOrEqual(EXACT);
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

test.describe("identity survives the drawer @mobile", () => {
  test("the mark stands beside the hamburger while the drawer is shut", async ({ page }) => {
    // Below 1024 the sidebar is off-canvas, so the sidebar's copy of the
    // brand is not drawn. Something still has to say what product this is,
    // or closing the drawer erases the identity of the page.
    await page.goto("/trades");
    const g = await readGeometry(page);
    expect(g.brandHost, "the brand is drawn in the masthead on a phone").toBe("masthead");
    await expect(page.locator("header [data-brand]")).toHaveAccessibleName(/InsiderFlow/);

    // The hamburger's DRAWN icon — not its 44px hit area — starts on the
    // content's left edge, so the bar and the page share one x here too.
    const icon = await page.locator("[data-testid='nav-drawer-trigger'] svg").boundingBox();
    expect(
      Math.abs(icon!.x - g.regionLeft),
      `menu glyph at ${Math.round(icon!.x)}, content at ${Math.round(g.regionLeft)}`,
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  test("the drawer header carries the brand, not the word 'Menu' @mobile", async ({ page }) => {
    await page.goto("/trades");
    await page.getByTestId("nav-drawer-trigger").click();
    const drawer = page.getByTestId("nav-drawer");
    await expect(drawer).toBeVisible();
    // Polled through `toBeVisible`, which retries: the panel springs in
    // from x:-100% and a box read on the first frame is a position it is
    // passing through.
    await expect(drawer.locator("[data-brand]")).toBeVisible();
    await expect(drawer.locator("[data-brand]")).toHaveAccessibleName(/InsiderFlow/);
    // Still never a nav state, in the drawer as everywhere else.
    await expect(drawer.locator("[data-brand][aria-current]")).toHaveCount(0);
  });
});

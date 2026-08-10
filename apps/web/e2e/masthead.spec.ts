import { test, expect, type Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * THE MASTHEAD'S FOUR SMALL PROMISES (r6).
 *
 * Each of these is cheap to add and cheap to break silently, which is the
 * combination that earns a test rather than a screenshot:
 *
 *   1. The bar draws no rule until something has scrolled under it.
 *   2. The two routes no sidebar item owns say where they sit.
 *   3. The accelerator names the key the reader's own keyboard has.
 *   4. The first thing a keyboard reaches is the way past the chrome.
 */

async function barStyle(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-masthead]")!;
    const s = getComputedStyle(el);
    return {
      scrolled: el.getAttribute("data-scrolled"),
      border: s.borderBottomColor,
      borderWidth: s.borderBottomWidth,
      // BOTH, joined. `backdropFilter` returns the string "none" rather
      // than an empty value when only the -webkit- alias is set, so `||`
      // silently reads the wrong one and the blur looks absent.
      backdrop: [
        s.backdropFilter,
        (s as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter,
      ]
        .filter((v) => v && v !== "none")
        .join(" "),
      transition: s.transitionDuration,
    };
  });
}

test.describe("the bar responds to the page moving under it", () => {
  test("a drawn bar at the top; blur added once content passes beneath", async ({ page }) => {
    // AMENDED in r7. r6 asserted NO rule at rest, on the reasoning that a
    // line across the screen before anything has scrolled under it is a
    // line about nothing. That was right about the line and wrong about
    // the bar: with neither ground nor edge, the landing's brand sat on
    // the page with nothing containing it, and on an app route the line
    // across the top of the window stopped dead at the sidebar's right
    // edge because the sidebar's own header rule WAS drawn.
    //
    // So the resting state is now a drawn bar, and scroll is purely
    // ADDITIVE. What this test protects is that the blur — the expensive
    // part, over a virtualized table — is still absent until it is doing
    // something.
    await page.goto("/trades");
    const top = await barStyle(page);
    expect(top.scrolled, "not scrolled yet").toBe("false");
    expect(top.border, "the bar has an edge at rest").not.toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(top.borderWidth), "the 1px is reserved").toBeGreaterThan(0);
    expect(top.backdrop, "no blur at rest").toBe("");

    await page.evaluate(() => window.scrollTo(0, 600));
    // Polled on the BLUR, which since r7 is the thing that actually
    // changes: the rule and the ground are drawn at rest, and scroll adds
    // the filter and more opacity on top of them. Polled rather than read
    // once, because `getComputedStyle` reports the value a transition is
    // passing through, and the claim is about the bar once it has settled.
    await expect
      .poll(async () => (await barStyle(page)).backdrop, { timeout: 8000 })
      .toContain("blur");
    expect((await barStyle(page)).scrolled, "and the state says so").toBe("true");
    expect((await barStyle(page)).border, "the rule is still drawn under scroll").not.toBe(
      "rgba(0, 0, 0, 0)",
    );

    // …and back. A one-way state would leave the blur on a page returned
    // to the top, which is the expensive half of the claim inverted.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await barStyle(page)).backdrop, { timeout: 8000 }).toBe("");
    expect((await barStyle(page)).scrolled).toBe("false");
  });

  test("the landing bar does the same thing", async ({ page }) => {
    await page.goto("/");
    const top = await barStyle(page);
    // Drawn at rest here too — this is the page the floating-brand report
    // was actually about.
    expect(top.border, "the landing bar has an edge at rest").not.toBe("rgba(0, 0, 0, 0)");
    expect(top.backdrop, "and no blur yet").toBe("");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect
      .poll(async () => (await barStyle(page)).backdrop, { timeout: 8000 })
      .toContain("blur");
  });

  test.describe("with prefers-reduced-motion", () => {
    test("the state still changes, and only the crossfade is dropped", async ({ page }) => {
      // `emulateMedia`, matching every other reduced-motion test in this
      // suite — the media state is what the CSS is written against.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/trades");
      const top = await barStyle(page);
      // The collapse comes from this file's blanket
      // `transition-duration: 0.01ms !important`, which is why the number
      // is 1e-05s and not 0s. Asserted as "effectively instant" rather
      // than as an exact string, so the test survives the mechanism.
      expect(
        parseFloat(top.transition),
        `crossfade should be instant, got ${top.transition}`,
      ).toBeLessThan(0.05);

      // The signal itself is not motion, so it is not removed. Taking it
      // away as well would leave a reader with the preference set unable
      // to tell a pinned bar from a static one.
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect
        .poll(async () => (await barStyle(page)).backdrop, { timeout: 8000 })
        .toContain("blur");
      expect((await barStyle(page)).scrolled, "the state still reports itself").toBe("true");
    });
  });
});

test.describe("breadcrumbs, on the two routes that need them", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZCRUM");
    insertSyntheticTrade(target, { tag: "breadcrumb" });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("a deep stock route names its section and its entity", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/stock/${target.ticker}`);
    const trail = page.getByTestId("breadcrumb");
    await expect(trail).toBeVisible();
    await expect(trail).toHaveAttribute("aria-label", /breadcrumb|पथ/i);

    // Home, then the section this entity belongs to, then the entity.
    await expect(trail.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/");
    await expect(trail.getByRole("link", { name: "Companies" })).toHaveAttribute(
      "href",
      "/companies",
    );

    const current = trail.locator("[aria-current='page']");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(target.ticker);
    // The last crumb is where you already are, so it is deliberately NOT a
    // link: a control that navigates to the page you are on does nothing.
    await expect(trail.locator("a[aria-current='page']")).toHaveCount(0);
  });

  test("an insider route shows the filer's name, not the id in the URL", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/insider/${target.insiderId}`);
    const current = page.getByTestId("breadcrumb").locator("[aria-current='page']");
    await expect(current).toBeVisible();
    const text = (await current.textContent())!.trim();
    expect(text.length, "the entity crumb is not empty").toBeGreaterThan(0);
    expect(text, "a uuid is not a name").not.toBe(target.insiderId);
  });

  test("shallow routes get none — the sidebar already says where you are", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ["/", "/trades", "/screener", "/leaderboard", "/settings", "/docs"]) {
      await page.goto(route);
      await expect(
        page.getByTestId("breadcrumb"),
        `${route}: a crumb here would restate the accent bar`,
      ).toHaveCount(0);
    }
  });

  test("the trail is cleared on leaving, not left pointing at the last page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/stock/${target.ticker}`);
    await expect(page.getByTestId("breadcrumb")).toBeVisible();
    await page.getByTestId("breadcrumb").getByRole("link", { name: "Companies" }).click();
    await expect(page).toHaveURL(/\/companies$/);
    // A stale breadcrumb is worse than none: it is a claim about where you
    // are, made about somewhere you have left.
    await expect(page.getByTestId("breadcrumb")).toHaveCount(0);
  });
});

test.describe("the palette hint names a key the reader has", () => {
  test("Ctrl on a PC", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/trades");
    await expect(page.getByTestId("palette-hint")).toHaveText(/ctrl/i);
  });

  test("⌘ on a Mac, and the swap costs no layout shift", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/trades");
    const before = (await page.getByTestId("open-palette").boundingBox())!.width;

    // BOTH sources, because the component reads `userAgentData.platform`
    // first — it is the one that is not deprecated, and Chromium answers
    // it. Overriding only `navigator.platform` tests nothing.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgentData", {
        get: () => ({ platform: "macOS" }),
      });
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    });
    await page.goto("/trades");
    const hint = page.getByTestId("palette-hint");
    await expect(hint).toHaveText("⌘K");

    // The server cannot know the platform, so the string is swapped after
    // hydration. `min-w` is what makes that free — without it this is a
    // two-character resize of the search button, and every control to its
    // right moves.
    const after = (await page.getByTestId("open-palette").boundingBox())!.width;
    expect(Math.abs(after - before), `${before} → ${after}`).toBeLessThanOrEqual(1);
  });

  test("it is a real <kbd> in the mono face, and decorative to assistive tech", async ({
    page,
  }) => {
    await page.goto("/trades");
    const hint = page.getByTestId("palette-hint");
    const info = await hint.evaluate((el) => ({
      tag: el.tagName,
      hidden: el.getAttribute("aria-hidden"),
      font: getComputedStyle(el).fontFamily,
      border: getComputedStyle(el).borderTopColor,
    }));
    expect(info.tag).toBe("KBD");
    // The button's accessible name already says what it does; "⌘K" read
    // aloud is noise.
    expect(info.hidden).toBe("true");
    expect(info.font, "keys are set in the mono face").toMatch(/plex mono/i);
    expect(info.border, "drawn from the border token").not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("the skip link is the way past the chrome", () => {
  const ROUTES = ["/", "/trades", "/screener", "/stock/ZZNOVA", "/docs", "/status", "/legal"];

  for (const route of ROUTES) {
    test(`is the first focusable thing on ${route}, and reveals itself`, async ({ page }) => {
      await page.goto(route);
      // One Tab from the document start. If anything in the chrome came
      // first, a keyboard reader would have to walk the whole masthead
      // before reaching the page.
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const s = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          href: el.getAttribute("href"),
          // `sr-only` clips to 1px; visible-on-focus has to be a real box.
          width: box.width,
          height: box.height,
          clip: s.clipPath,
        };
      });
      expect(focused, `${route}: nothing took focus`).not.toBeNull();
      expect(focused!.tag, `${route}: first tab stop`).toBe("A");
      expect(focused!.href, `${route}: it points at the main region`).toBe("#main");
      expect(focused!.width, `${route}: it must be visible once focused`).toBeGreaterThan(40);
      expect(focused!.height, `${route}`).toBeGreaterThan(16);
    });
  }

  test("the target can actually take focus", async ({ page }) => {
    await page.goto("/trades");
    // Following a fragment to a non-focusable element moves the scroll
    // position and leaves the keyboard exactly where it was — the reader
    // tabs on into the masthead they just skipped.
    const main = await page.locator("#main").getAttribute("tabindex");
    expect(main, "#main must be programmatically focusable").toBe("-1");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const landed = await page.evaluate(() => document.activeElement?.id ?? null);
    expect(landed, "focus lands in the content, not on <body>").toBe("main");
  });
});

test("the tab icon is served and is the brand mark", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator("link[rel~='icon']").first().getAttribute("href");
  expect(href, "the document declares an icon").toBeTruthy();
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("svg");
});

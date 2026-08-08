import { test, expect } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  type SyntheticCompany,
} from "./fixtures";

/**
 * THE TAPE.
 *
 * Three additions, each with a way to get it wrong:
 *   - the arrival flash must be the DIRECTION's tint, not the accent
 *     (which means "actionable" everywhere else), and must stop under
 *     reduced motion;
 *   - the quick actions must be real controls that a keyboard can reach,
 *     not hover-only functionality;
 *   - the keyboard must move focus without turning the feed into thirty
 *     tab stops.
 */

/**
 * The keyboard handlers live in a client component, so a test that
 * presses a key before hydration is testing static HTML. Wait for the
 * network to settle and for at least one row to exist.
 */
async function gotoTape(page: import("@playwright/test").Page, url = "/trades") {
  await page.goto(url, { waitUntil: "networkidle" });
  await expect(page.locator("[data-tape-row]").first()).toBeVisible();
}

let target: SyntheticCompany;

test.beforeAll(() => {
  target = createSyntheticCompany("ZZTAPE");
  insertSyntheticTrade(target, { tag: "tape" });
});

test.afterAll(() => {
  cleanupSyntheticCompany(target);
});

test.describe("tape keyboard", () => {
  test("the list is one tab stop, and the arrows walk it", async ({ page }) => {
    await gotoTape(page);
    const list = page.getByTestId("history-rows");
    await expect(list).toBeVisible();

    /** Which row index currently holds focus, or -1. */
    const focusedIndex = () =>
      page.evaluate(() => {
        const rows = Array.from(
          document.querySelectorAll("[data-testid='history-rows'] [data-tape-row]"),
        );
        return rows.indexOf(document.activeElement as Element);
      });

    // Focusing the list lands on the first row, not on the list itself.
    await list.focus();
    expect(await focusedIndex()).toBe(0);

    await page.keyboard.press("ArrowDown");
    expect(await focusedIndex()).toBe(1);

    await page.keyboard.press("ArrowUp");
    expect(await focusedIndex()).toBe(0);

    // …and it does not walk off the top.
    await page.keyboard.press("ArrowUp");
    expect(await focusedIndex()).toBe(0);
  });

  test("rows are not individual tab stops", async ({ page }) => {
    await gotoTape(page);
    // Every row must be programmatically focusable but out of the tab
    // order, or tabbing past the feed means thirty presses.
    const tabbable = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("[data-tape-row]")).filter(
          (el) => (el as HTMLElement).tabIndex >= 0,
        ).length,
    );
    expect(tabbable).toBe(0);

    const lists = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("ul[aria-label]")).filter(
          (el) => (el as HTMLElement).tabIndex === 0,
        ).length,
    );
    expect(lists).toBeGreaterThan(0);
  });

  test("Enter opens the focused row's company", async ({ page }) => {
    await gotoTape(page);
    const list = page.getByTestId("history-rows");
    await list.focus();
    const href = await page.evaluate(
      () => document.activeElement?.getAttribute("data-tape-href") ?? null,
    );
    expect(href).toMatch(/^\/stock\//);
    await page.keyboard.press("Enter");
    await page.waitForURL(`**${href}`);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("w tracks the focused company, signed out via the sign-in offer", async ({ page }) => {
    await gotoTape(page);
    const list = page.getByTestId("history-rows");
    await list.focus();
    await page.keyboard.press("w");

    // Signed out, the offer appears rather than a refusal. Signed out is
    // the state e2e runs in, so this is the branch under test.
    const offer = page.getByRole("dialog");
    await expect(offer).toBeVisible();
    await expect(offer).not.toContainText(/unlock|upgrade|premium|pro plan/i);
  });

  test("the shortcut sheet documents the keys and opens from ?", async ({ page }) => {
    await gotoTape(page);
    await page.keyboard.press("?");
    const sheet = page.getByTestId("shortcut-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Move between rows");
    await expect(sheet).toContainText("Open the focused row");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Also reachable without knowing the convention.
    await page.getByTestId("shortcut-sheet-open").first().click();
    await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
  });

  test("? is not stolen from a text field", async ({ page }) => {
    await gotoTape(page);
    // The command palette is the text field that is always present, and
    // it is exactly where a stolen "?" would be most annoying.
    await page.keyboard.press("ControlOrMeta+k");
    // `[cmdk-input]` specifically: getByRole("combobox") also matches the
    // filter bar's <select>, and pressing a key on a select is not the
    // thing under test.
    const field = page.locator("[cmdk-input]").first();
    await expect(field).toBeVisible();
    await field.press("?");
    await expect(page.getByTestId("shortcut-sheet")).toBeHidden();
    await expect(field).toHaveValue("?");
  });
});

test.describe("tape quick actions", () => {
  test("every row offers track and alert as real controls", async ({ page }) => {
    await gotoTape(page);
    const row = page.locator("[data-tape-row]").first();
    const watch = row.getByTestId("row-watch");
    const alert = row.getByTestId("row-alert");

    // Present in the DOM regardless of hover — hover only reveals them.
    await expect(watch).toHaveCount(1);
    await expect(alert).toHaveCount(1);
    await expect(watch).toHaveAttribute("aria-label", /track/i);
    await expect(alert).toHaveAttribute("aria-label", /alert/i);

    // Reachable from the keyboard: focusing the row brings them up. The
    // reveal is a 120ms transition, and getComputedStyle mid-transition
    // returns the value it is passing through, not the one it is heading
    // for — so this waits for it to land rather than reading the start.
    await watch.focus();
    await expect
      .poll(() =>
        watch.evaluate((el) => Number(getComputedStyle(el.closest(".tape-actions")!).opacity)),
      )
      .toBeGreaterThan(0.9);
  });

  test("the copy never frames free data as gated", async ({ page }) => {
    await gotoTape(page);
    const row = page.locator("[data-tape-row]").first();
    // Hover the ROW first, as a mouse user does. The hidden state of
    // `.tape-actions` is now `pointer-events: none` as well as transparent —
    // an invisible control that still takes clicks is worse than a hidden
    // one, and hybrid laptops report `pointer: fine` while also having a
    // touchscreen. Playwright hit-tests before it moves the mouse, so
    // without this it waits forever for a button that is only clickable
    // once the pointer is on its way to it.
    await row.hover();
    await row.getByTestId("row-watch").click();

    const offer = page.getByRole("dialog");
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(/sign in/i);
    await expect(offer).not.toContainText(/unlock|upgrade|premium|paywall/i);

    await page.keyboard.press("Escape");
    await expect(offer).toBeHidden();
  });
});

test.describe("arrival flash", () => {
  // Long enough to outlive a full ~25s server SSE window, as live-stream
  // does — the row has to arrive over the wire for the flash to be real.
  test.setTimeout(120_000);
  // And retried for the same reason live-stream is: the four-per-client SSE
  // ceiling is shared with every other worker. See e2e/live-stream.spec.ts.
  test.describe.configure({ retries: 2 });

  test("a streamed row flashes its value in the direction's own tint", async ({ page }) => {
    await gotoTape(page);
    await expect(page.getByTestId("live-fold")).toBeVisible();

    // A unique share count per run: the fixture dedups on it, and a
    // repeat insert is a no-op that never reaches the stream.
    const shares = 700_000 + Math.floor(Math.random() * 99_999);
    const dedup = insertSyntheticTrade(target, { shares, tag: `flash-${shares}` });
    const arrived = page.locator(".tape-arrival").first();
    await expect(arrived).toBeVisible({ timeout: 60_000 });

    const flash = await arrived.evaluate((row) => {
      const cell = row.querySelector("[data-cell='value']")!;
      const s = getComputedStyle(cell);
      return { name: s.animationName, direction: cell.getAttribute("data-direction") };
    });

    // Buy or sell — never the accent, which in this system means
    // "actionable" and must not be read as a side.
    expect(flash.name).toMatch(/^tape-flash-(buy|sell)$/);
    expect(flash.direction === "A" ? "tape-flash-buy" : "tape-flash-sell").toBe(flash.name);
    expect(dedup).toBeTruthy();
  });

  test("reduced motion turns the flash off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoTape(page);

    // Assert the rule directly rather than racing a live arrival: what
    // matters is that the declaration is off under the media query.
    const name = await page.evaluate(() => {
      const row = document.querySelector("[data-tape-row]") as HTMLElement;
      row.classList.add("tape-arrival");
      const cell = row.querySelector("[data-cell='value']") as HTMLElement;
      cell.setAttribute("data-direction", "A");
      return getComputedStyle(cell).animationName;
    });
    expect(name).toBe("none");
  });
});

test.describe("the tape on a phone @mobile", () => {
  test("the row folds to two lines and the insider's name is readable", async ({ page }) => {
    await gotoTape(page);
    const row = page.locator("[data-tape-row]").first();

    // The failure this replaces: at 360px the name column was the only
    // flexible cell in a row whose fixed siblings already consumed the
    // width, so `flex-1` resolved to about twelve pixels and `truncate`
    // rendered a single ellipsis. Nothing overflowed — `overflow: hidden`
    // zeroes a flex item's automatic minimum size — so the page looked
    // fine and the subject of every row was simply gone.
    const geometry = await row.evaluate((el) => {
      const cell = (name: string) =>
        el.querySelector(`[data-cell="${name}"]`)!.getBoundingClientRect();
      const ticker = cell("ticker");
      const insider = cell("insider");
      const value = cell("value");
      return {
        rowHeight: el.getBoundingClientRect().height,
        // Line 1 and line 2 are on different baselines…
        foldedBelow: Math.round(insider.top - ticker.top),
        // …and the value stays on line 1, right of the ticker.
        valueOnLineOne: Math.abs(value.top - ticker.top) < 4 && value.left > ticker.left,
        insiderWidth: Math.round(insider.width),
        insiderTruncated: false,
      };
    });

    expect(geometry.foldedBelow, "the insider line sits below the ticker line").toBeGreaterThan(10);
    expect(geometry.valueOnLineOne, "the amount stays on line one, right-aligned").toBe(true);
    expect(geometry.rowHeight, "two lines need real height").toBeGreaterThan(48);
    // The name column, measured. Twelve pixels was the r3 number.
    expect(geometry.insiderWidth, "the insider name column").toBeGreaterThan(120);

    // And the name is actually shown, not ellipsed away.
    const insiderText = await row.locator('[data-cell="insider"]').innerText();
    expect(insiderText.replace(/…|\.\.\./g, "").trim().length).toBeGreaterThan(6);
  });

  test("the quick actions are reachable by tapping, not by hovering", async ({ page }) => {
    await gotoTape(page);
    const row = page.locator("[data-tape-row]").first();

    // r3 gated the whole action group behind an `@lg` container query, so
    // below a 512px container it was `display: none` — the feature was not
    // hard to reach on a phone, it was absent from the page.
    const menu = row.getByTestId("row-menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(43);
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(43);

    await menu.tap();
    const content = page.getByTestId("row-menu-content");
    await expect(content).toBeVisible();
    await expect(content.getByTestId("row-menu-watch")).toBeVisible();
    await expect(content.getByTestId("row-menu-alert")).toBeVisible();
    // 44px rows in the menu too.
    const itemBox = await content.getByTestId("row-menu-watch").boundingBox();
    expect(Math.round(itemBox!.height)).toBeGreaterThanOrEqual(43);
  });

  test("tapping track while signed out offers sign-in rather than refusing", async ({ page }) => {
    await gotoTape(page);
    const row = page.locator("[data-tape-row]").first();
    await row.getByTestId("row-menu").tap();
    await page.getByTestId("row-menu-watch").tap();

    // By test id, not by role: the row menu is itself a Radix popover with
    // `role="dialog"` and stays mounted when closed, so `getByRole("dialog")`
    // matches two elements here and fails strict mode on an app that is
    // behaving correctly.
    const offer = page.getByTestId("sign-in-offer");
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(/sign in/i);
    await expect(offer).not.toContainText(/unlock|upgrade|premium|paywall/i);
  });

  test("the hover-revealed pair is not rendered at all", async ({ page }) => {
    await gotoTape(page);
    // A hover-revealed control on a touchscreen appears on the tap meant
    // to activate it. Below sm the pair is not merely transparent.
    await expect(page.locator("[data-tape-row]").first().getByTestId("row-watch")).toBeHidden();
  });
});

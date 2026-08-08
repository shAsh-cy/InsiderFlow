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
    const field = page.getByRole("combobox").or(page.locator("[cmdk-input]")).first();
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

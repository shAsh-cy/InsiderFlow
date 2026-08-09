import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * THE SHELL ON A PHONE. @mobile
 *
 * Below lg the sidebar is gone and one button is the only route to eleven
 * destinations. r3 rendered that button at `size-8` with no `shrink-0` in a
 * flex row that was already 43px over budget at 360px, so it was compressed
 * to roughly seventeen pixels wide — a functional failure, not a cosmetic
 * one, and invisible to a suite that only ever rendered 1280px.
 *
 * These run in the `mobile` project, which sets `hasTouch` and `isMobile`.
 * That is the load-bearing part: it makes `(hover: hover) and (pointer:
 * fine)` false, which is the condition every hover-gated affordance in this
 * product is written against.
 */

/** WCAG 2.5.5 (AAA) — and the size the brief asks for at mobile widths. */
const TARGET = 44;

async function expectTarget(locator: Locator, name: string) {
  // `boundingBox()` does NOT auto-wait for visibility — it returns null the
  // moment the element is attached but not yet laid out. Under eight workers
  // that lost the race about one run in ten and reported it as "no box",
  // which reads as a missing control rather than as a test that measured too
  // early. `toBeVisible` is the wait.
  await expect(locator, `${name} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${name} has no box`).not.toBeNull();
  expect(Math.round(box!.width), `${name} width`).toBeGreaterThanOrEqual(TARGET - 1);
  expect(Math.round(box!.height), `${name} height`).toBeGreaterThanOrEqual(TARGET - 1);
}

async function openDrawer(page: Page) {
  const trigger = page.getByTestId("nav-drawer-trigger");
  await trigger.click();
  await expect(page.getByTestId("nav-drawer")).toBeVisible();
  return trigger;
}

test.describe("the navigation drawer @mobile", () => {
  test("the trigger is a real target and the sidebar is not rendered", async ({ page }) => {
    await page.goto("/trades");
    await expectTarget(page.getByTestId("nav-drawer-trigger"), "drawer trigger");
    // The sidebar's own <aside> must not be occupying width below lg.
    await expect(page.locator("aside.sticky")).toBeHidden();
  });

  test("it opens, traps focus, and reaches every destination", async ({ page }) => {
    await page.goto("/trades");
    await openDrawer(page);
    const drawer = page.getByTestId("nav-drawer");

    // It is off-canvas from the LEFT, not a centred sheet.
    const box = await drawer.boundingBox();
    expect(Math.round(box!.x), "drawer is flush to the left edge").toBeLessThanOrEqual(1);
    expect(box!.height, "drawer is full height").toBeGreaterThan(700);

    // Every non-"soon" sidebar destination is reachable here, since this is
    // the only navigation below lg.
    const links = drawer.locator("a[href]");
    expect(await links.count()).toBeGreaterThanOrEqual(10);

    // Focus is inside the drawer, and Tab does not escape it.
    await page.keyboard.press("Tab");
    for (let i = 0; i < 25; i += 1) {
      const inside = await page.evaluate(() => {
        const el = document.activeElement;
        return Boolean(el?.closest("[data-testid='nav-drawer']"));
      });
      expect(inside, `focus escaped the drawer after ${i} tabs`).toBe(true);
      await page.keyboard.press("Tab");
    }
  });

  test("Escape closes it and returns focus to the trigger", async ({ page }) => {
    await page.goto("/trades");
    const trigger = await openDrawer(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-drawer")).toBeHidden();

    // Radix's own onCloseAutoFocus cancels FocusScope's restore and focuses
    // `context.triggerRef`, which is only populated by <DialogTrigger>. This
    // drawer is opened by a plain button, so without an explicit handler
    // focus lands on <body> and a keyboard user is returned to the top of
    // the document. Asserting the trigger is the point of this test.
    await expect(trigger).toBeFocused();
  });

  test("tapping the scrim closes it", async ({ page }) => {
    await page.goto("/trades");
    await openDrawer(page);
    // Well right of the 19rem panel.
    await page.mouse.click(370, 500);
    await expect(page.getByTestId("nav-drawer")).toBeHidden();
  });

  test("the active route is marked, and only once", async ({ page }) => {
    await page.goto("/leaderboard");
    await openDrawer(page);
    const current = page.locator("[data-testid='nav-drawer'] [aria-current='page']");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("href", "/leaderboard");
    // The brand is never a nav state — the r3 rule, still true in the drawer.
    await expect(page.locator("[data-brand][aria-current]")).toHaveCount(0);
  });

  test("navigating from the drawer closes it", async ({ page }) => {
    await page.goto("/trades");
    await openDrawer(page);
    await page.locator("[data-testid='nav-drawer'] a[href='/heatmap']").click();
    await expect(page).toHaveURL(/\/heatmap$/);
    await expect(page.getByTestId("nav-drawer")).toBeHidden();
  });
});

test.describe("the condensed masthead @mobile", () => {
  test("every control in the bar is a 44px target", async ({ page }) => {
    await page.goto("/trades");
    await expectTarget(page.getByTestId("nav-drawer-trigger"), "menu");
    await expectTarget(page.getByTestId("open-palette"), "search");
    await expectTarget(page.getByTestId("shell-overflow"), "overflow menu");
    const signIn = page.locator("header a[href='/login']");
    if ((await signIn.count()) > 0) {
      const box = await signIn.boundingBox();
      expect(Math.round(box!.height), "sign in height").toBeGreaterThanOrEqual(TARGET - 1);
    }
  });

  test("the brand keeps its accessible name with the wordmark hidden", async ({ page }) => {
    await page.goto("/trades");
    // `sr-only`, not `hidden`: a link to the home page with no accessible
    // name is what `hidden` would have produced on every phone.
    await expect(page.locator("[data-brand]")).toHaveAccessibleName(/InsiderFlow/);
  });

  test("language and theme are reachable — the r3 build hid both below 640", async ({ page }) => {
    await page.goto("/trades");
    // The locale switcher's ONLY mount point in r3 was the masthead, behind
    // `hidden sm:inline-flex`. A reader on a phone could not pick a
    // language, and one who had picked Hindi on a desktop was stuck in it.
    await page.getByTestId("shell-overflow").click();
    const menu = page.getByTestId("shell-overflow-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("group", { name: /language|भाषा/i })).toBeVisible();
    await expect(menu.getByRole("button", { name: /switch to (light|dark)|theme/i })).toBeVisible();
  });

  test("the locale switcher actually switches the catalogue", async ({ page }) => {
    await page.goto("/trades");
    await page.getByTestId("shell-overflow").click();
    await page.getByTestId("shell-overflow-menu").getByRole("button", { name: "हिन्दी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");

    // Reload rather than clicking straight through: the switcher writes a
    // cookie and calls `router.refresh()` inside a transition, so the menu
    // it lives in is re-rendered out from under the next click. Reloading
    // also tests the half that matters — the choice survives a navigation.
    await page.goto("/trades");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");

    // …and back out again, which is the half that was impossible in r3.
    await page.getByTestId("shell-overflow").click();
    await page.getByTestId("shell-overflow-menu").getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("search opens the palette full-screen", async ({ page }) => {
    await page.goto("/trades");
    await page.getByTestId("open-palette").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const viewport = page.viewportSize()!;
    // Polled, not read once: the dialog opens with a `zoom-in-95`, so a
    // single read lands at 97% of the final width and reports a failure
    // about a layout that is correct. Measuring an element mid-transition
    // is the same mistake r3 made with `getComputedStyle`.
    //
    // A centred 328px sheet leaves three visible result rows once the
    // keyboard is up. Full-bleed is the difference between a search and a
    // peephole.
    await expect
      .poll(async () => (await dialog.boundingBox())!.width, { timeout: 4000 })
      .toBeGreaterThanOrEqual(viewport.width - 1);
    const box = await dialog.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height * 0.9);
  });
});

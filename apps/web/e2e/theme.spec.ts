import { test, expect, type Page } from "@playwright/test";

/**
 * DARK IS THE DEFAULT, AND IT IS NOT THE MACHINE'S DECISION.
 *
 * Terminal is a dark-first identity: the token layer is written with
 * `:root` AS the dark theme and `.light` as the override, and the accent is
 * tuned twice because one green cannot be both a fill and a legible label
 * on two grounds. Deferring that to `prefers-color-scheme` meant roughly
 * half of all first visitors met a theme the design does not lead with.
 *
 * Three separate things are asserted here, because they fail separately:
 *
 *   the DEFAULT is dark, even when the OS says light;
 *   a STORED choice still wins, because taking someone's preference away
 *   is a worse bug than the one being fixed;
 *   and there is no FLASH — the class is decided before first paint, not
 *   corrected after hydration.
 *
 * Every test runs in a fresh context. A suite that shares storage between
 * tests would have the first toggle silently decide the rest.
 */

/**
 * Record every value `<html>`'s class attribute ever holds, starting before
 * any page script runs. next-themes writes its class from a blocking inline
 * script in `<head>`; if that script were wrong, or if the class were only
 * corrected on hydration, the wrong value would appear in this list.
 */
async function recordThemeClasses(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __themeClasses: string[] }).__themeClasses = [];
    const record = () => {
      const seen = (window as unknown as { __themeClasses: string[] }).__themeClasses;
      const value = document.documentElement.className;
      if (seen[seen.length - 1] !== value) seen.push(value);
    };
    // An init script runs BEFORE `document.documentElement` exists, so
    // attaching the observer straight away throws and silently records
    // nothing — which reads as "the page never changed class" rather than
    // as "the instrument never started". Retry until the element is there;
    // next-themes' own class-setting script is blocking and lives in
    // <head>, so this is still watching from before first paint.
    const start = () => {
      if (!document.documentElement) return false;
      record();
      new MutationObserver(record).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      return true;
    };
    if (!start()) {
      const timer = setInterval(() => {
        if (start()) clearInterval(timer);
      }, 0);
    }
  });
}

/** The resolved ground colour, so the assertion is about pixels not classes. */
async function background(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** Terminal `--bg` is #0c0f0e; Graphite is #f6f8fa. */
const DARK_BG = "rgb(12, 15, 14)";
const LIGHT_BG = "rgb(246, 248, 250)";

test.describe("theme default", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a first visit with no stored preference lands in dark", async ({ page }) => {
    await recordThemeClasses(page);
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/\blight\b/);
    expect(await background(page)).toBe(DARK_BG);

    await page.goto("/trades");
    await expect(page.locator("html")).not.toHaveClass(/\blight\b/);
    expect(await background(page)).toBe(DARK_BG);
  });

  test("the OS preference does not override it", async ({ page }) => {
    // The whole point of `enableSystem={false}`. Before r5 this visitor got
    // Graphite — a theme the product does not lead with, chosen by their
    // laptop rather than by them.
    await page.emulateMedia({ colorScheme: "light" });
    await recordThemeClasses(page);
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/\blight\b/);
    expect(await background(page)).toBe(DARK_BG);
  });

  test("there is no wrong-theme flash before hydration", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await recordThemeClasses(page);
    await page.goto("/", { waitUntil: "networkidle" });

    const seen = await page.evaluate(
      () => (window as unknown as { __themeClasses: string[] }).__themeClasses,
    );
    // Not one of the values `<html>` ever held may have been the light
    // theme. A class corrected after hydration is a visible flash, and it
    // is the single most common way a dark-first site gets this wrong.
    expect(seen.length, "no class values recorded — the observer did not run").toBeGreaterThan(0);
    for (const value of seen) {
      expect(value, `<html> passed through "${value}" (saw: ${seen.join(" → ")})`).not.toMatch(
        /\blight\b/,
      );
    }
  });
});

test.describe("theme choice", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the toggle switches to light and says so", async ({ page }) => {
    await page.goto("/trades");
    expect(await background(page)).toBe(DARK_BG);

    await page.getByRole("button", { name: /switch to light/i }).click();
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    expect(await background(page)).toBe(LIGHT_BG);

    // The control now offers the way back — its accessible name is the
    // destination, not the current state.
    await expect(page.getByRole("button", { name: /switch to dark/i })).toBeVisible();
  });

  test("a stored preference survives a reload and a navigation", async ({ page }) => {
    // The half of this that matters most: r5 changes the DEFAULT, it does
    // not clear anyone's choice. A browser that was toggled to light before
    // this change stays light.
    await page.goto("/trades");
    await page.getByRole("button", { name: /switch to light/i }).click();
    await expect(page.locator("html")).toHaveClass(/\blight\b/);

    await page.reload();
    expect(await background(page)).toBe(LIGHT_BG);

    await page.goto("/screener");
    expect(await background(page)).toBe(LIGHT_BG);

    const stored = await page.evaluate(() => window.localStorage.getItem("insiderflow-theme"));
    expect(stored).toBe("light");
  });

  test("a light preference stored before r5 is still honoured on first paint", async ({ page }) => {
    // Seeded the way an existing visitor's browser would already have it.
    await page.addInitScript(() => {
      window.localStorage.setItem("insiderflow-theme", "light");
    });
    await recordThemeClasses(page);
    await page.goto("/");
    expect(await background(page)).toBe(LIGHT_BG);

    // …and it arrives before paint, not after: the first recorded class
    // already carries it.
    const seen = await page.evaluate(
      () => (window as unknown as { __themeClasses: string[] }).__themeClasses,
    );
    expect(seen.at(-1)).toMatch(/\blight\b/);
  });
});

import { expect, test } from "@playwright/test";

/**
 * Acceptance checks for the design system: every primitive renders, the
 * 10k-row DataTable actually virtualizes (few DOM rows, smooth scroll),
 * and reduced-motion is honored.
 */
test.setTimeout(90_000);

test("design showcase renders every primitive", async ({ page }) => {
  await page.goto("/design", { waitUntil: "networkidle" });

  // All 20 transaction codes render as badges in the showcase grid.
  await expect(page.getByRole("button", { name: /^Code P:/ }).first()).toBeVisible();
  const grid = page.getByLabel("Transaction codes — all 20, colored by signal weight");
  await expect(grid.getByRole("button", { name: /^Code [A-Z]:/ })).toHaveCount(20);

  // Dual-currency, lakh/crore, and the not-disclosed treatment.
  await expect(page.getByText("₹24.5 Cr · $2.79M").first()).toBeVisible();
  await expect(page.getByText("$2.79M", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Not disclosed in the filing").first()).toBeAttached();

  // Badges and status.
  await expect(page.getByText("opportunistic").first()).toBeVisible();
  await expect(page.getByText("EDGAR").first()).toBeVisible();
  await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
});

test("DataTable virtualizes 10k rows and sorts", async ({ page }) => {
  await page.goto("/design", { waitUntil: "networkidle" });

  const table = page.getByRole("table", { name: /10,000 rows/ });
  await expect(table).toBeVisible();

  // Virtualization: only a small window of rows exists in the DOM.
  const domRows = await table.locator("tbody tr[data-index]").count();
  expect(domRows).toBeGreaterThan(5);
  expect(domRows).toBeLessThan(80); // ~10k rows would be catastrophic here

  // Scrolling deep keeps the DOM small and advances the rendered window.
  const firstIndexBefore = await table
    .locator("tbody tr[data-index]")
    .first()
    .getAttribute("data-index");
  await page.getByTestId("data-table-scroll").evaluate((el) => {
    el.scrollTop = 120_000;
  });
  await expect
    .poll(async () =>
      Number(
        (await table.locator("tbody tr[data-index]").first().getAttribute("data-index")) ?? "0",
      ),
    )
    .toBeGreaterThan(Number(firstIndexBefore ?? "0") + 100);
  expect(await table.locator("tbody tr[data-index]").count()).toBeLessThan(80);

  // Sorting: header exposes aria-sort and toggles.
  const dateHeader = page.getByRole("columnheader", { name: /Date/ });
  await expect(dateHeader).toHaveAttribute("aria-sort", "none");
  await dateHeader.getByRole("button").click();
  await expect(dateHeader).toHaveAttribute("aria-sort", "ascending");
});

test("scrolling 10k rows sustains ~60fps", async ({ page }) => {
  await page.goto("/design", { waitUntil: "networkidle" });
  const scroller = page.getByTestId("data-table-scroll");

  // Drive ~1.2s of scrolling and measure frame cadence via rAF.
  const result = await scroller.evaluate(async (el: HTMLElement) => {
    const frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const start = performance.now();
    while (performance.now() - start < 1200) {
      el.scrollTop += 60;
      await new Promise((r) => requestAnimationFrame(r));
    }
    cancelAnimationFrame(raf);

    const sorted = [...frames].sort((a, b) => a - b);
    return {
      frames: frames.length,
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    };
  });

  // 60fps = 16.7ms/frame. Allow headroom for CI noise but catch real jank.
  expect(result.frames).toBeGreaterThan(30);
  expect(result.median).toBeLessThan(20);
  expect(result.p95).toBeLessThan(50);
});

test("reduced motion disables non-essential animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });

  const ambientAnimation = await page
    .locator(".ambient-a")
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(ambientAnimation).toBe("none");

  const pulseAnimation = await page
    .locator(".live-pulse")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName)
    .catch(() => "none");
  expect(pulseAnimation).toBe("none");
});

test("keyboard access: skip link, palette shortcut, focus rings", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  // Skip link is the first tab stop.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  // ⌘K / Ctrl+K opens the command palette, Escape closes it.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await expect(page.getByPlaceholder(/Jump to a page/)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();
});

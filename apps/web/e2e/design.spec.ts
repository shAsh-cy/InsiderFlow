import { expect, test } from "@playwright/test";

/**
 * Interaction coverage for the design showcase. Structural checks
 * (virtualization bounds, fps, reduced motion, keyboard) live in
 * design-system.spec.ts.
 */
test.describe("design system showcase", () => {
  test("renders the showcase with dual-currency and not-disclosed treatments", async ({ page }) => {
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Design");
    await expect(page.getByText("₹24.5 Cr · $2.79M").first()).toBeVisible();
    await expect(page.getByText("SAST rows carry no value by design")).toBeVisible();
  });

  test("column sort toggles and exposes aria-sort", async ({ page }) => {
    await page.goto("/design");
    // Numeric columns sort descending-first (TanStack's convention: the
    // biggest numbers are what you usually want on the first click).
    const shares = page.getByRole("columnheader", { name: /Shares/ });
    await expect(shares).toHaveAttribute("aria-sort", "none");
    await shares.getByRole("button").click();
    await expect(shares).toHaveAttribute("aria-sort", "descending");
    await shares.getByRole("button").click();
    await expect(shares).toHaveAttribute("aria-sort", "ascending");

    // Text columns sort ascending-first.
    const insider = page.getByRole("columnheader", { name: /Insider/ });
    await insider.getByRole("button").click();
    await expect(insider).toHaveAttribute("aria-sort", "ascending");
  });

  test("animated demo rows insert without a reload", async ({ page }) => {
    await page.goto("/design");
    const feed = page.getByTestId("demo-feed");
    const before = await feed.locator("li").count();
    await page.getByRole("button", { name: "Inject demo trade" }).click();
    await expect(feed.locator("li")).toHaveCount(before + 1);
    // The showcase caps the demo list at 5 rows.
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Inject demo trade" }).click();
    }
    await expect(feed.locator("li")).toHaveCount(5);
  });
});

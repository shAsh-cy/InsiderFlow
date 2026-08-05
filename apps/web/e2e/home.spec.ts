import { expect, test } from "@playwright/test";

test("home page renders with the legal disclaimer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "InsiderFlow", level: 1 })).toBeVisible();
  // Scoped to <main>: Next's route announcer is also role="alert" (and empty),
  // so an unscoped getByRole("alert") is a strict-mode violation once the
  // client router has hydrated.
  await expect(page.locator("main").getByRole("alert")).toContainText("Not investment advice");
});

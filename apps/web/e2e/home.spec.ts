import { expect, test } from "@playwright/test";

test("home page renders with the legal disclaimer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "InsiderFlow", level: 1 })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Not investment advice");
});

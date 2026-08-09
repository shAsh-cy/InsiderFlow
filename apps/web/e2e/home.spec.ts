import { expect, test } from "@playwright/test";

test("home page renders with the legal disclaimer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "InsiderFlow", level: 1 })).toBeVisible();

  // Located by testid rather than by `role="alert"` since r6, because the
  // disclaimer no longer has that role and should never have had it: an
  // alert is an ASSERTIVE live region, so a static legal notice that is
  // present on every load made every screen reader interrupt itself to
  // read it, on arrival, every time. The claim being tested here is that
  // the landing page carries the disclaimer, not which ARIA role it wears.
  //
  // It also moved out of the hero and into the footer — see
  // e2e/landing-footer.spec.ts, which pins both ends of that move.
  const disclaimer = page.getByTestId("footer-disclaimer");
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toContainText("Not investment advice");
});

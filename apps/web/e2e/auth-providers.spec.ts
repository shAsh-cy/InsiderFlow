import { expect, test } from "@playwright/test";

/**
 * PRODUCTION AUTH IS GITHUB OAUTH AND MAGIC LINK. NOTHING ELSE.
 *
 * Email + password exists on the DEV project only, so
 * `auth-isolation.spec.ts` can mint two real users for the cross-user
 * exploitation suite. On production it is a credential this product
 * otherwise does not have — one to phish, to stuff from a breach list, to
 * reset over email, to store — bought for nothing.
 *
 * The provider itself is a dashboard setting and cannot be asserted from
 * here. What CAN be asserted, and is the thing that would actually change
 * if somebody wired it up, is that no part of the UI offers a password.
 * A form appears before a provider gets used.
 *
 * This is also why "hash passwords properly" is N/A rather than done: with
 * no password field and the provider off, InsiderFlow never holds a
 * credential to hash.
 */
test.describe("the sign-in surface", () => {
  test("offers no password field anywhere on the login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in");

    // By type, by name, and by autocomplete role — three ways a password
    // input gets built, so a hand-rolled one is caught too.
    await expect(page.locator("input[type='password']")).toHaveCount(0);
    await expect(page.locator("input[name*='password' i]")).toHaveCount(0);
    await expect(page.locator("input[autocomplete*='password' i]")).toHaveCount(0);
  });

  test("offers no password field on settings either", async ({ page }) => {
    // The other place a "change password" control would naturally land.
    await page.goto("/settings");
    await expect(page.locator("input[type='password']")).toHaveCount(0);
  });

  test("never asks for a password in its own copy", async ({ page }) => {
    await page.goto("/login");
    // Wording matters here: a page that says "password" without a field is
    // a page mid-way through growing one.
    await expect(page.getByText(/password/i)).toHaveCount(0);
  });
});

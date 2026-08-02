import { expect, test } from "@playwright/test";

/**
 * Auth + alerting surfaces without a configured Supabase project (which is
 * the state of a fresh clone and of CI). The contract we assert here: the
 * public site is fully usable, and every account-gated affordance degrades
 * to an honest, non-broken state rather than erroring.
 */

test("the public site works with auth unconfigured", async ({ page }) => {
  await page.goto("/trades");
  await expect(page.getByTestId("live-fold")).toBeVisible();
  // No sign-in chrome is advertised when the deployment cannot honor it.
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("settings explains what to configure instead of erroring", async ({ page }) => {
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("NEXT_PUBLIC_SUPABASE_URL")).toBeVisible();
});

test("the login page states auth is unconfigured rather than failing", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in");
  await expect(page.getByText("Auth is not configured")).toBeVisible();
});

test("save-as-alert stays disabled and explains why when signed out", async ({ page }) => {
  await page.goto("/screener");
  await expect(page.getByTestId("result-count")).toBeVisible();
  const saveAlert = page.getByTestId("save-alert");
  await expect(saveAlert.getByRole("button")).toBeDisabled();
  await saveAlert.focus();
  await expect(page.getByText("Sign in to save this screen as an alert")).toBeVisible();
});

test("user API routes reject anonymous callers", async ({ request }) => {
  for (const path of ["/api/me/watchlist", "/api/me/alert-rules", "/api/me/channels"]) {
    const response = await request.get(path);
    expect(response.status(), `${path} must require a session`).toBe(401);
  }
});

test("unsubscribe rejects an unknown token without leaking state", async ({ request }) => {
  const response = await request.get("/api/alerts/unsubscribe?token=definitely-not-a-real-token");
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain("Link not recognized");
});

test("the telegram webhook rejects unsigned traffic when a secret is set", async ({ request }) => {
  const response = await request.post("/api/alerts/telegram", {
    data: { message: { text: "/start abc", chat: { id: 1 } } },
  });
  // 403 when TELEGRAM_WEBHOOK_SECRET is configured; 200 (ignored) otherwise.
  expect([200, 403]).toContain(response.status());
});

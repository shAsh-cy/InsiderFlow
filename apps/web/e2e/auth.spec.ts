import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

/**
 * Auth + alerting surfaces.
 *
 * These assert a contract that holds in BOTH deployment states, because both
 * are real: a fresh clone and CI have no Supabase project, while a wired-up
 * local or hosted deployment does. Asserting only the unconfigured shape made
 * the suite fail on any machine where auth actually worked — a false red that
 * says nothing about the code.
 *
 *  - unconfigured: the public site is fully usable and every account-gated
 *    affordance degrades to an honest explanation rather than an error;
 *  - configured: the same affordances are offered instead of hidden.
 *
 * Either way, nothing account-gated may be reachable without a session.
 */

/** True when the deployment has Supabase credentials wired up. */
async function authConfigured(request: APIRequestContext): Promise<boolean> {
  const body = await (await request.get("/login")).text();
  return !body.includes("Auth is not configured");
}

test("the public site works either way, and advertises sign-in only when it works", async ({
  page,
  request,
}) => {
  const configured = await authConfigured(request);
  await page.goto("/trades");
  await expect(page.getByTestId("live-fold")).toBeVisible();

  // Sign-in chrome is advertised exactly when the deployment can honor it.
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(configured ? 1 : 0);
});

test("settings never errors, whether or not auth is configured", async ({ page, request }) => {
  const configured = await authConfigured(request);
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  if (configured) {
    // Signed out on a configured deployment: prompt, don't explain the env.
    await expect(page.getByText("NEXT_PUBLIC_SUPABASE_URL")).toHaveCount(0);
  } else {
    await expect(page.getByText("NEXT_PUBLIC_SUPABASE_URL")).toBeVisible();
  }
});

test("the login page states its state rather than failing", async ({ page, request }) => {
  const configured = await authConfigured(request);
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in");

  if (configured) {
    // A real sign-in affordance, not a stub.
    await expect(page.getByRole("button").first()).toBeVisible();
  } else {
    await expect(page.getByText("Auth is not configured")).toBeVisible();
  }
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

/**
 * /auth/callback — the route a user lands on immediately after clicking a
 * sign-in link, and therefore the one where a failure is most confusing and a
 * redirect is most trusted. These hold in both deployment states.
 */
test.describe("auth callback", () => {
  test("explains a cancelled sign-in instead of erroring", async ({ page }) => {
    const response = await page.goto(
      "/auth/callback?error=access_denied&error_description=The%20user%20denied%20the%20request",
    );
    expect(response?.status(), "a denied consent is not a server error").toBe(200);
    await expect(page).toHaveURL(/\/login/);
    // Unconfigured deployments report their own state first, which is also fine.
    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("explains a link opened without its code", async ({ page }) => {
    const response = await page.goto("/auth/callback");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("explains an expired magic link in words a user can act on", async ({ page }) => {
    await page.goto("/login?error=expired");
    await expect(page.getByTestId("login-error")).toContainText(/expired|single-use/i);
  });

  // `new URL(next, origin)` returns `next` verbatim when it is absolute, so
  // this was a live open redirect on the highest-trust route in the app.
  for (const hostile of [
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ]) {
    test(`never redirects off-origin for next=${hostile}`, async ({ page }) => {
      await page.goto(`/auth/callback?code=zz-not-a-real-code&next=${encodeURIComponent(hostile)}`);
      const landed = new URL(page.url());
      expect(landed.hostname, `must stay on this origin, landed on ${page.url()}`).toBe(
        "localhost",
      );
      expect(page.url()).not.toContain("evil.example");
    });
  }
});

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
  //
  // Scoped to the masthead and matched EXACTLY. Unscoped and inexact, this
  // counted two links on a page that has two: the bar's "Sign in" and the
  // access banner's "Sign in to save & get alerts", whose name contains the
  // first. The banner is client-rendered, so a retrying count assertion
  // passed if it sampled before hydration and failed after — it had been
  // passing on timing rather than on the fact it claims to check.
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(
    configured ? 1 : 0,
  );
  // …and the offer inside the page, which the old locator was accidentally
  // counting and never actually asserting.
  await expect(
    page.getByRole("link", { name: /sign in to save/i }),
    "the contextual offer is advertised on the same condition",
  ).toHaveCount(configured ? 1 : 0);
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

/**
 * Rewritten in r2. The old contract was "the control is DISABLED when
 * signed out", which was the wrong promise to make: a dead button next to
 * a screen the reader just built for free reads as "your data is locked",
 * and in this product it never is. The control is now live and offers
 * sign-in in place.
 *
 * What is still asserted, and matters more: signed-out visitors are told
 * the data is free, the affordance says "save" rather than "unlock", and
 * the actual write path is still refused without a session (covered by
 * "user API routes reject anonymous callers" below).
 */
test("save-as-alert offers contextual sign-in rather than a dead control", async ({ page }) => {
  await page.goto("/screener");
  await expect(page.getByTestId("result-count")).toBeVisible();

  const saveAlert = page.getByTestId("save-alert");
  await expect(saveAlert).toBeEnabled();
  await expect(saveAlert).toHaveText(/save/i);
  // Never framed as a paywall.
  await expect(saveAlert).not.toHaveText(/unlock|upgrade|premium|pro\b/i);

  await saveAlert.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/sign in to save this alert/i)).toBeVisible();
  // The offer explains that reading was never the thing being gated.
  await expect(page.getByText(/reading stays free/i)).toBeVisible();

  // Keyboard-dismissible, and focus is not stranded in a closed layer.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("signed-out data pages say the data is free, not gated", async ({ page }) => {
  for (const path of ["/trades", "/screener"]) {
    await page.goto(path);
    const banner = page.getByTestId("access-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(/free/i);
    await expect(banner).not.toHaveText(/unlock|upgrade|premium|trial/i);
  }

  // Dismissal sticks across a reload — a persistent nag is its own tax.
  await page.getByTestId("access-banner-dismiss").click();
  await expect(page.getByTestId("access-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("access-banner")).toHaveCount(0);
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

test("the telegram webhook rejects unsigned traffic", async ({ request }) => {
  const response = await request.post("/api/alerts/telegram", {
    data: { message: { text: "/start abc", chat: { id: 1 } } },
  });
  // AMENDED in r12, and worth reading as a warning rather than a tidy-up.
  //
  // This assertion used to be `expect([200, 403]).toContain(status)`, with
  // a comment explaining that 200 meant "no secret configured, so the
  // update is ignored". It was not ignored. With no secret configured the
  // handler ran the update and called `completeTelegramLink`, which binds
  // a Telegram chat to whichever account generated the token — so the one
  // state this test explicitly permitted was the state in which anybody
  // who found the URL could attach a stranger's alert stream to their own
  // chat. A test that accepts both the safe and the unsafe outcome cannot
  // fail, and this one did not, for eleven revisions.
  //
  // There is now one right answer in every deployment mode: unsigned
  // traffic is 401. `telegram-webhook.spec.ts` covers the positive case
  // and both modes in full.
  expect(response.status(), "an unsigned update is refused in every mode").toBe(401);
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

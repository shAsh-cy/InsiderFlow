import { expect, test } from "@playwright/test";

/**
 * THE MASTHEAD'S AUTH AFFORDANCE (r7, Item B).
 *
 * The chip is rendered from the session the SERVER resolved. Nothing in
 * the bar asks the browser who is signed in, which is what lets a
 * signed-out reader load this site without the auth SDK: the 187 kB of
 * `@supabase/ssr` reached every route through a static import chain that
 * started at a tape row's sign-in offer, and it now arrives only inside
 * the click that actually signs somebody in.
 *
 * What can honestly be asserted from here, and what cannot:
 *
 *   SIGNED OUT — asserted below, on the landing and on an app route.
 *   COOKIE PRESENT BUT NOT VALID — asserted below. This is the case that
 *     matters: an expired or forged `sb-*-auth-token` must resolve to no
 *     user and render the sign-in link, never a chip belonging to nobody.
 *   SIGNED IN — NOT asserted here, deliberately. Minting a valid session
 *     cookie means either a test-only server bypass or real credentials in
 *     CI, and neither belongs in an application entering a security
 *     review. The branch is a pure function of `SessionInfo` and is
 *     covered in src/lib/auth/account-state.test.ts, which tests all four
 *     states including this one.
 */

test.describe("signed out", () => {
  for (const route of ["/", "/trades"]) {
    test(`${route} offers a plain sign-in link and no menu`, async ({ page }) => {
      await page.goto(route);
      const header = page.locator("header");

      const signIn = header.locator("a[href='/login']");
      await expect(signIn).toBeVisible();
      await expect(signIn).toHaveText(/sign in/i);

      // No chip, and — the point of the exercise — no overlay for one.
      await expect(header.getByTestId("account-chip")).toHaveCount(0);
      await expect(page.getByTestId("account-menu")).toHaveCount(0);
    });
  }

  test("the landing ships no auth SDK for a reader who has not signed in", async ({ page }) => {
    const scripts: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.endsWith(".js")) scripts.push(url);
    });
    await page.goto("/", { waitUntil: "networkidle" });

    // Sampled by content rather than by chunk name, because chunk names are
    // build hashes and a rename would silently retire this test.
    const bodies = await Promise.all(
      scripts.map(async (url) => {
        const res = await page.request.get(url);
        return { url, text: await res.text() };
      }),
    );
    // Fingerprints of the SDK ITSELF — the auth, postgrest and realtime
    // clients inside `@supabase/supabase-js`.
    //
    // Deliberately NOT `createBrowserClient` and NOT the project URL. The
    // lazy loader that knows how to fetch the SDK is still on the landing:
    // it is a few lines, it names its import, and it inlines
    // `NEXT_PUBLIC_SUPABASE_URL` for the "is auth even configured" check.
    // Matching on those would flag the fix as the bug it fixed.
    const offenders = bodies
      .filter(({ text }) => /GoTrueClient|PostgrestClient|RealtimeClient|SupabaseClient/.test(text))
      .map(({ url }) => url.split("/").pop());
    expect(
      offenders,
      `the landing's first-load graph must not contain the auth SDK: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

test.describe("a cookie that does not resolve to a user", () => {
  const FORGED = [
    // Shape-correct but signed by nobody.
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ6ei1ub3QtYS1yZWFsLXVzZXIiLCJleHAiOjk5OTk5OTk5OTl9.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    // Expired, and past even a generous clock skew.
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ6ei1zdGFsZSIsImV4cCI6MTAwMDAwMDAwMH0.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  ];

  for (const [index, token] of FORGED.entries()) {
    test(`renders the sign-in link, not a chip (${index === 0 ? "forged" : "expired"})`, async ({
      page,
      context,
      baseURL,
    }) => {
      const { hostname } = new URL(baseURL!);
      // Supabase's cookie name is project-scoped; several plausible
      // spellings are planted so the test does not depend on which one this
      // deployment happens to use.
      await context.addCookies(
        ["sb-access-token", "sb-localhost-auth-token", "supabase-auth-token"].map((name) => ({
          name,
          value: token,
          domain: hostname,
          path: "/",
        })),
      );

      await page.goto("/trades");
      const header = page.locator("header");
      await expect(
        header.getByTestId("account-chip"),
        "an unverifiable cookie must never draw an account",
      ).toHaveCount(0);
      await expect(header.locator("a[href='/login']")).toBeVisible();

      // …and the page itself still works. Refusing to render because a
      // cookie is stale would be a worse failure than ignoring it.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});

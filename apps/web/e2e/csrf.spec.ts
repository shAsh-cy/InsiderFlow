import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { psql } from "./fixtures";
import { SUPABASE_ANON_KEY, SUPABASE_URL, contextFor, signUpAndCaptureCookies } from "./session";
import type { AuthedUser } from "./session";

/**
 * THE SAME-ORIGIN GATE, over real requests.
 *
 * `src/lib/security/csrf.test.ts` covers the decision itself against the
 * header values a browser and an attacker actually produce. This file
 * covers the three things a unit test cannot:
 *
 *   1. that the decision is WIRED to all EIGHT cookie-authenticated
 *      mutating handlers — seven on the three `/api/me/*` routes
 *      (watchlist POST and DELETE, alert-rules POST, PATCH and DELETE,
 *      channels POST and PATCH) plus `POST /auth/signout`. The count is
 *      written out because it drifted once already: three comments said
 *      "six" while the table at the bottom of this file listed seven, and
 *      a comment that miscounts the surface it certifies reads later as
 *      "one handler is deliberately excluded";
 *   2. that a refusal is a 403 with the project's error shape, and that
 *      the mutation did not happen anyway — the status is not the point,
 *      the missing row is;
 *   3. that it did NOT leak onto `/api/alerts/telegram` or
 *      `/api/alerts/unsubscribe`, which are exempt on purpose and would
 *      be broken outright by an origin allowlist.
 *
 * ── WHY THIS SPEC SIGNS IN, AND WHAT IT COSTS ─────────────────────────
 *
 * These routes answer 401 when signed out, and the suite runs signed out
 * by default. A naive version of this file could not tell a CSRF refusal
 * apart from an ordinary auth failure — every assertion would be 401 and
 * deleting the gate entirely would not move it. So it mints real Supabase
 * sessions the same way `auth-isolation.spec.ts` does (shared helpers in
 * `./session`), which makes the 403 observable.
 *
 * The two ordering tests at the bottom are the exception: they need no
 * session by construction, so they run everywhere.
 *
 * ── WHY EVERY REQUEST HERE NAMES ITS ORIGIN EXPLICITLY ────────────────
 *
 * Playwright's `APIRequestContext` sends neither `Origin` nor `Referer`
 * (measured against a local probe server). A real browser sends both on a
 * mutation. Every request below therefore states which of the two worlds
 * it is imitating, and none of them relies on Playwright's default —
 * relying on it is how a test ends up asserting something about a request
 * shape that no browser can produce.
 */

const EVIL = "https://evil.example";

const rand = () => Math.random().toString(36).slice(2, 10);

interface Mutation {
  label: string;
  /** Sent with whatever Origin the caller names, so both worlds share one definition. */
  send: (api: APIRequestContext, headers: Record<string, string>) => Promise<APIResponse>;
}

test.describe("same-origin gate on the cookie-authenticated write surface", () => {
  test.describe.configure({ mode: "serial" });

  let user: AuthedUser | null = null;
  let baseURL = "";
  let siteOrigin = "";

  /**
   * A missing prerequisite is a SKIP on a bare run and a FAILURE when the
   * runner was aimed at a deployment on purpose.
   *
   * ── WHY THE ASYMMETRY, AND WHY IT IS NOT THE ENVIRONMENT TRAP ─────
   *
   * The whole authenticated block used to be a plain `test.skip`, which
   * meant the only proof over HTTP that the gate answers 403 could
   * evaporate silently. Not just on misconfiguration either: sign-up hits
   * Supabase's free-tier rate limit, `signUpAndCaptureCookies` returns
   * null for that too, and six refusal tests then skip while the suite
   * reports green. The mitigation was a `console.warn` plus an
   * annotation, which under `reporter: "github"` is a log line nobody
   * reads.
   *
   * `PLAYWRIGHT_BASE_URL` is the signal because it is the one thing that
   * says a human meant this run to measure a real server: the config
   * treats it as "skip the managed build and point at that". Bare
   * `pnpm test:e2e` on a laptop with no Supabase project still skips, and
   * says so; a targeted run against localhost:3100 or a preview fails
   * loudly instead of quietly proving nothing.
   *
   * This reads the RUNNER's environment to learn how the runner was
   * invoked. That is not the trap this project has been bitten by twice —
   * inferring the SERVER's configuration from `process.env` in a test.
   * Nothing here concludes anything about what the server has set; the
   * server's own answers are still the only evidence used.
   */
  const targetedRun = Boolean(process.env.PLAYWRIGHT_BASE_URL);

  const requirePrerequisite = (missing: boolean, reason: string): void => {
    if (!missing) return;
    if (targetedRun) {
      throw new Error(
        `[csrf] PLAYWRIGHT_BASE_URL is set, so this run was meant to verify a real ` +
          `server and cannot report success without doing it. ${reason}`,
      );
    }
    // Playwright's list reporter prints "n skipped" and nothing else,
    // which reads the same as "n passed" to anyone scanning CI output.
    console.warn(`\n[csrf] SKIPPED — ${reason}\n`);
    test.skip(true, reason);
  };

  test.beforeAll(async ({ baseURL: configured }) => {
    baseURL = configured ?? "http://localhost:3000";
    siteOrigin = new URL(baseURL).origin;
    requirePrerequisite(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      "No Supabase project configured, so no session can be minted and a CSRF refusal " +
        "cannot be told apart from an ordinary 401. The 403 path is therefore UNVERIFIED " +
        "over HTTP on this run; src/lib/security/csrf.test.ts still covers the decision.",
    );
    user = await signUpAndCaptureCookies(
      `zz-csrf-${rand()}@insiderflow-test.invalid`,
      `zz-${rand()}-${rand()}`,
    );
    requirePrerequisite(
      !user,
      "Password sign-up returned no session, so the 403 path is UNVERIFIED over HTTP. " +
        "Either email+password sign-up is off, email confirmation is on, or the project " +
        "is rate-limiting sign-ups — the last one is not misconfiguration, and is exactly " +
        "why this cannot be allowed to pass quietly.",
    );
  });

  test.afterAll(() => {
    if (!user) return;
    psql(`delete from user_watchlists where user_id = '${user.id}'`);
    psql(`delete from alert_rules where user_id = '${user.id}'`);
    psql(`delete from alert_channels where user_id = '${user.id}'`);
  });

  // ── /api/me/watchlist ─────────────────────────────────────────────────

  test("a cross-origin POST to the watchlist is refused, and writes nothing", async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, user!, baseURL);
    const refId = `ZZCSRF${rand().toUpperCase()}`;

    const attack = await ctx.request.post("/api/me/watchlist", {
      // The victim's session cookie rides along automatically, which is
      // the whole attack: the browser attaches it because the cookie is
      // the entire credential.
      headers: { Origin: EVIL },
      data: { kind: "company", refId, label: "planted cross-origin", market: "US" },
    });
    expect(attack.status(), "a cross-origin watchlist write must be refused").toBe(403);
    expect((await attack.json()).error.code).toBe("forbidden");
    expect(attack.headers()["cache-control"], "a refusal must not be cached").toContain("no-store");

    // THE ASSERTION WITH THE TEETH. The status is a claim about the
    // response; this is a claim about the DATABASE. Delete the gate and
    // the row appears here whatever the status line said.
    const after = await (await ctx.request.get("/api/me/watchlist")).text();
    expect(after, "the refused cross-origin write must not have landed").not.toContain(refId);
    expect(
      psql(`select count(*) from user_watchlists where ref_id = '${refId}'`),
      "a cross-origin request wrote a watchlist row",
    ).toBe("0");

    await ctx.close();
  });

  test("a same-origin POST to the watchlist still succeeds", async ({ browser }) => {
    // The pair to every refusal in this file. Without it, a gate that
    // refused EVERYTHING would leave the whole spec green.
    const ctx = await contextFor(browser, user!, baseURL);
    const refId = `ZZOK${rand().toUpperCase()}`;

    const ok = await ctx.request.post("/api/me/watchlist", {
      headers: { Origin: siteOrigin },
      data: { kind: "company", refId, label: "written same-origin", market: "US" },
    });
    expect(ok.status(), "the app's own write must go through untouched").toBe(200);

    const after = await (await ctx.request.get("/api/me/watchlist")).text();
    expect(after, "the same-origin write must actually have landed").toContain(refId);

    await ctx.close();
  });

  test("a cross-origin DELETE on the watchlist is refused, and deletes nothing", async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, user!, baseURL);
    const refId = `ZZKEEP${rand().toUpperCase()}`;

    const seed = await ctx.request.post("/api/me/watchlist", {
      headers: { Origin: siteOrigin },
      data: { kind: "company", refId, label: "must survive", market: "US" },
    });
    expect(seed.status(), "the row under attack has to exist first").toBe(200);

    const attack = await ctx.request.delete(`/api/me/watchlist?kind=company&refId=${refId}`, {
      headers: { Origin: EVIL },
    });
    expect(attack.status()).toBe(403);

    const after = await (await ctx.request.get("/api/me/watchlist")).text();
    expect(after, "the row must survive a cross-origin delete").toContain(refId);

    // …and the same delete from our own origin does work, so the survival
    // above is the gate and not a broken delete.
    const legitimate = await ctx.request.delete(`/api/me/watchlist?kind=company&refId=${refId}`, {
      headers: { Origin: siteOrigin },
    });
    expect(legitimate.status()).toBe(200);
    const gone = await (await ctx.request.get("/api/me/watchlist")).text();
    expect(gone, "the same-origin delete must actually delete").not.toContain(refId);

    await ctx.close();
  });

  // ── /api/me/alert-rules ───────────────────────────────────────────────

  test("cross-origin POST, PATCH and DELETE on alert rules are refused, and change nothing", async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, user!, baseURL);
    const name = `ZZ csrf rule ${rand()}`;

    // Seed same-origin, which doubles as the positive case for POST.
    const created = await ctx.request.post("/api/me/alert-rules", {
      headers: { Origin: siteOrigin },
      data: { name, trackedTicker: "ZZNOVA", channels: ["telegram"] },
    });
    expect(created.status(), "the app's own rule creation must go through").toBe(201);
    const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

    const plantedName = `ZZ planted ${rand()}`;
    const plant = await ctx.request.post("/api/me/alert-rules", {
      headers: { Origin: EVIL },
      data: { name: plantedName, trackedTicker: "ZZNOVA", channels: ["telegram"] },
    });
    expect(plant.status(), "a cross-origin rule creation must be refused").toBe(403);
    expect((await plant.json()).error.code).toBe("forbidden");

    const rename = await ctx.request.patch("/api/me/alert-rules", {
      headers: { Origin: EVIL },
      data: { id: ruleId, name: "ZZ hijacked cross-origin" },
    });
    expect(rename.status(), "a cross-origin rename must be refused").toBe(403);

    const destroy = await ctx.request.delete(`/api/me/alert-rules?id=${ruleId}`, {
      headers: { Origin: EVIL },
    });
    expect(destroy.status(), "a cross-origin delete must be refused").toBe(403);

    // Again: the database is the subject, not the status line.
    const after = await (await ctx.request.get("/api/me/alert-rules")).text();
    expect(after, "the rule must survive the cross-origin delete").toContain(ruleId);
    expect(after, "the rule must keep its name").toContain(name);
    expect(after, "the cross-origin rename must not have applied").not.toContain(
      "ZZ hijacked cross-origin",
    );
    expect(after, "the cross-origin creation must not have landed").not.toContain(plantedName);
    expect(
      psql(`select count(*) from alert_rules where name = '${plantedName}'`),
      "a cross-origin request created an alert rule",
    ).toBe("0");

    // The same three verbs from our own origin, so none of the above is
    // satisfied by a route that simply stopped working.
    const okRename = await ctx.request.patch("/api/me/alert-rules", {
      headers: { Origin: siteOrigin },
      data: { id: ruleId, name: `${name} renamed` },
    });
    expect(okRename.status()).toBe(200);
    const okDelete = await ctx.request.delete(`/api/me/alert-rules?id=${ruleId}`, {
      headers: { Origin: siteOrigin },
    });
    expect(okDelete.status()).toBe(200);
    const gone = await (await ctx.request.get("/api/me/alert-rules")).text();
    expect(gone, "the same-origin delete must actually delete").not.toContain(ruleId);

    await ctx.close();
  });

  // ── /api/me/channels ──────────────────────────────────────────────────

  test("cross-origin POST and PATCH on channels are refused, and change nothing", async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, user!, baseURL);
    const zone = `ZZ/csrf-${rand()}`;

    // Seed a channel row and a known timezone from our own origin. PATCH
    // is 200 for any signed-in user regardless of deployment config, which
    // is why it — and not POST — carries the exact-status positive case
    // for this route.
    psql(
      `insert into alert_channels (user_id, channel, verified)
       values ('${user!.id}', 'telegram', false)
       on conflict (user_id, channel) do nothing`,
    );
    const seed = await ctx.request.patch("/api/me/channels", {
      headers: { Origin: siteOrigin },
      data: { channel: "telegram", digestHour: "04:00", timezone: zone },
    });
    expect(seed.status(), "the app's own preference update must go through").toBe(200);

    const hijack = await ctx.request.patch("/api/me/channels", {
      headers: { Origin: EVIL },
      data: { channel: "telegram", digestHour: "23:00", timezone: "ZZ/hijacked" },
    });
    expect(hijack.status(), "a cross-origin preference change must be refused").toBe(403);
    expect((await hijack.json()).error.code).toBe("forbidden");

    const after = await (await ctx.request.get("/api/me/channels")).text();
    expect(after, "the timezone must be untouched by the cross-origin patch").toContain(zone);
    expect(after).not.toContain("ZZ/hijacked");

    // POST mints a Telegram link token — a cross-origin page that could
    // trigger it would be racing the victim for their own alert stream.
    const link = await ctx.request.post("/api/me/channels", {
      headers: { Origin: EVIL },
      data: { action: "link-telegram" },
    });
    expect(link.status(), "a cross-origin link-telegram must be refused").toBe(403);

    // The same-origin counterpart. Its SUCCESS status is not asserted
    // exactly, and that is deliberate rather than lazy: the route answers
    // 200 with TELEGRAM_BOT_USERNAME set on the SERVER and 503 without,
    // and the runner cannot see the server's environment — this project
    // has twice shipped a test that inferred one from the other and was
    // wrong. A status array would be the other way to write this, and the
    // lint gate rightly refuses it. So the claim made here is exactly the
    // claim this file is about, no more: the gate did not refuse it. The
    // exact-status positive for this route is the PATCH above.
    const ownLink = await ctx.request.post("/api/me/channels", {
      headers: { Origin: siteOrigin },
      data: { action: "link-telegram" },
    });
    expect(
      ownLink.status(),
      "the app's own link-telegram must not be refused as cross-origin",
    ).not.toBe(403);

    await ctx.close();
  });

  // ── Referer fallback, over a real request ─────────────────────────────

  test("a request with no Origin is judged by its Referer, both ways", async ({ browser }) => {
    // NO context-level Origin. Per-request headers merge OVER the
    // context's and there is no way to unset one, so a request with a
    // Referer and genuinely no Origin — the shape a privacy setting or a
    // `Referrer-Policy` can produce — is only reachable from a context
    // that never set Origin in the first place.
    const ctx = await contextFor(browser, user!, baseURL, {});
    const refId = `ZZREF${rand().toUpperCase()}`;

    const hostileReferer = await ctx.request.post("/api/me/watchlist", {
      headers: { Referer: `${EVIL}/landing` },
      data: { kind: "company", refId, label: "referred from evil", market: "US" },
    });
    expect(hostileReferer.status(), "a hostile Referer must be refused").toBe(403);
    expect(
      psql(`select count(*) from user_watchlists where ref_id = '${refId}'`),
      "a hostile-Referer request wrote a row",
    ).toBe("0");

    const ourReferer = await ctx.request.post("/api/me/watchlist", {
      headers: { Referer: `${siteOrigin}/settings` },
      data: { kind: "company", refId, label: "referred from us", market: "US" },
    });
    expect(ourReferer.status(), "our own Referer must be accepted when Origin is absent").toBe(200);

    // And with neither header, which is the rule that makes the gate
    // worth having: a browser always sends Origin on a mutation, so this
    // shape is never legitimate traffic to this route.
    const neither = await ctx.request.post("/api/me/watchlist", {
      data: { kind: "company", refId: `${refId}N`, label: "no headers at all", market: "US" },
    });
    expect(neither.status(), "neither Origin nor Referer must be refused").toBe(403);

    await ctx.close();
  });

  // ── /auth/signout ─────────────────────────────────────────────────────
  //
  // LAST IN THIS SERIAL BLOCK ON PURPOSE. The positive half really does
  // sign the fixture user out, and `supabase.auth.signOut()` revokes the
  // refresh token server-side, so every later test sharing these cookies
  // would answer 401 for a reason that has nothing to do with what it is
  // testing.

  test("a cross-origin POST to /auth/signout is refused, and the session survives", async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, user!, baseURL);
    // The precondition, asserted rather than assumed: if the session were
    // already dead, the "survives" assertion below would pass by accident.
    expect(
      (await ctx.request.get("/api/me/watchlist")).status(),
      "the fixture session must be live before this test means anything",
    ).toBe(200);

    const attack = await ctx.request.post("/auth/signout", {
      headers: { Origin: EVIL },
      // Without this the 303 is followed and the status becomes the
      // landing page's, which would hide both outcomes.
      maxRedirects: 0,
    });
    expect(attack.status(), "a cross-origin sign-out must be refused").toBe(403);
    expect((await attack.json()).error.code).toBe("forbidden");

    // THE ASSERTION WITH THE TEETH. A cross-origin auto-submitting form is
    // a simple request — no preflight — so before the gate reached this
    // route any page on the internet could end a visitor's session. The
    // status is a claim about the response; this is a claim about the
    // SESSION, and sign-out revokes it server-side rather than only
    // clearing a cookie.
    expect(
      (await ctx.request.get("/api/me/watchlist")).status(),
      "the refused cross-origin sign-out destroyed the session anyway",
    ).toBe(200);

    // …and the same POST from our own origin does end it, so the survival
    // above is the gate working and not sign-out being broken.
    const own = await ctx.request.post("/auth/signout", {
      headers: { Origin: siteOrigin },
      maxRedirects: 0,
    });
    expect(own.status(), "the app's own sign-out must still work").toBe(303);
    expect(
      (await ctx.request.get("/api/me/watchlist")).status(),
      "the same-origin sign-out must actually end the session",
    ).toBe(401);

    await ctx.close();
  });
});

/**
 * ── THE ORDERING PROPERTY ─────────────────────────────────────────────
 *
 * Signed out, a cross-origin mutation must still be 401 and not 403.
 *
 * Not a stylistic preference. A 403 to an anonymous caller would answer a
 * question the caller has no right to ask: an attacker's page fires this
 * at a visitor and learns from the status whether that visitor holds a
 * session on InsiderFlow. Putting the session check first makes the two
 * cases indistinguishable from the outside.
 *
 * Runs with no session and no Supabase, so it holds on every deployment.
 */
test.describe("the gate sits behind the session check, not in front of it", () => {
  const MUTATIONS: Mutation[] = [
    {
      label: "POST /api/me/watchlist",
      send: (r, headers) =>
        r.post("/api/me/watchlist", {
          headers,
          data: { kind: "company", refId: "ZZANON", label: "anon", market: "US" },
        }),
    },
    {
      label: "DELETE /api/me/watchlist",
      send: (r, headers) => r.delete("/api/me/watchlist?kind=company&refId=ZZANON", { headers }),
    },
    {
      label: "POST /api/me/alert-rules",
      send: (r, headers) =>
        r.post("/api/me/alert-rules", {
          headers,
          data: { name: "ZZ anon rule", channels: ["telegram"] },
        }),
    },
    {
      label: "PATCH /api/me/alert-rules",
      send: (r, headers) =>
        r.patch("/api/me/alert-rules", {
          headers,
          data: { id: "00000000-0000-4000-8000-0000000ff0f0", name: "ZZ anon rename" },
        }),
    },
    {
      label: "DELETE /api/me/alert-rules",
      send: (r, headers) =>
        r.delete("/api/me/alert-rules?id=00000000-0000-4000-8000-0000000ff0f0", { headers }),
    },
    {
      label: "POST /api/me/channels",
      send: (r, headers) =>
        r.post("/api/me/channels", { headers, data: { action: "link-telegram" } }),
    },
    {
      label: "PATCH /api/me/channels",
      send: (r, headers) =>
        r.patch("/api/me/channels", {
          headers,
          data: { channel: "telegram", digestHour: "09:00" },
        }),
    },
  ];

  test("every mutating /api/me handler answers 401, not 403, to an anonymous cross-origin caller", async ({
    request,
    baseURL,
  }) => {
    // Taken from the fixture, never hardcoded: PLAYWRIGHT_BASE_URL points
    // this suite at a deployed preview in CI, and a literal localhost here
    // would silently turn the same-origin half into a second cross-origin
    // case — the two would agree for the wrong reason.
    const ownOriginValue = new URL(baseURL!).origin;

    for (const mutation of MUTATIONS) {
      const hostile = await mutation.send(request, { Origin: EVIL });
      expect(hostile.status(), `${mutation.label} — anonymous and cross-origin`).toBe(401);

      // Same handler, same absent session, our own origin. Identical
      // answer, which is the property: the status must reveal nothing
      // about where the request came from until the caller is known.
      const ownOrigin = await mutation.send(request, { Origin: ownOriginValue });
      expect(ownOrigin.status(), `${mutation.label} — anonymous and same-origin`).toBe(401);
    }
  });
});

/**
 * ── SIGN-OUT, WITH NO SESSION AT ALL ──────────────────────────────────
 *
 * `/auth/signout` is the one gated route where the origin check runs
 * BEFORE any look at the session, and that is deliberate rather than
 * inconsistent. On `/api/me/*` the 401 must come first so a 403 cannot
 * tell an attacker's page that the visitor is signed in; here there is no
 * such oracle to protect, because the route answers 303 whether or not a
 * session existed. The refusal is a function of `Origin` alone, and these
 * two assertions are what says so — a signed-out visitor and a signed-in
 * one get the same answer for the same origin.
 *
 * Needs no Supabase, so it runs on every deployment.
 */
test.describe("sign-out is gated by origin alone, not by session state", () => {
  test("a cross-origin sign-out is 403 and a same-origin one is 303, with no session", async ({
    request,
    baseURL,
  }) => {
    const hostile = await request.post("/auth/signout", {
      headers: { Origin: EVIL },
      maxRedirects: 0,
    });
    expect(hostile.status(), "anonymous and cross-origin").toBe(403);
    expect((await hostile.json()).error.code).toBe("forbidden");

    const own = await request.post("/auth/signout", {
      headers: { Origin: new URL(baseURL!).origin },
      maxRedirects: 0,
    });
    expect(own.status(), "anonymous and same-origin — the gate must not refuse this").toBe(303);
    expect(own.headers()["location"], "sign-out redirects home").toContain("/");
  });
});

/**
 * ── THE EXEMPTIONS ────────────────────────────────────────────────────
 *
 * `/api/alerts/telegram` and `/api/alerts/unsubscribe` are deliberately
 * NOT origin-gated; both route files carry the reasoning. Neither is
 * browser-origin-bound, both are called by machines that send no `Origin`
 * and no `Referer`, and each already has its own credential — a constant-
 * time secret header, and a single-use capability token in the URL.
 *
 * These are regression guards, not coverage of those routes (which
 * `telegram-webhook.spec.ts` and `auth.spec.ts` own). Their job is to go
 * red the day somebody applies the gate to every mutating handler in the
 * app, which is a reasonable-sounding change that silently breaks
 * one-click unsubscribe and every genuine Telegram update.
 */
test.describe("the routes that are exempt on purpose stay exempt", () => {
  test("the telegram webhook still answers 401 with no Origin — the CSRF gate did not leak onto it", async ({
    request,
  }) => {
    // No Origin, no Referer, no secret: exactly what an attacker who
    // found the URL sends, and structurally what Telegram sends minus the
    // secret. 401 says the SECRET was what turned it away. A 403 would
    // mean the origin gate got there first, and that a genuine Telegram
    // update — which also carries no Origin — is now refused too.
    const noSecret = await request.post("/api/alerts/telegram", {
      data: { update_id: 1, message: { text: "/start abc123", chat: { id: 424242 } } },
    });
    expect(
      noSecret.status(),
      "no Origin and no secret must be 401 from the secret check, never 403 from the origin gate",
    ).toBe(401);
    expect((await noSecret.json()).error.code).toBe("unauthorized");

    // And with a wrong secret, still no Origin: same answer, same reason.
    const wrongSecret = await request.post("/api/alerts/telegram", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "not-the-secret" },
      data: { update_id: 2, message: { text: "/start abc123", chat: { id: 424242 } } },
    });
    expect(wrongSecret.status()).toBe(401);
  });

  test("one-click unsubscribe still reaches its token check with no Origin", async ({
    request,
  }) => {
    // RFC 8058 List-Unsubscribe-Post: mail providers call this
    // server-to-server with no Origin and no Referer. 404 is the token
    // check answering "not a real token" — i.e. the request got all the
    // way to the credential that actually guards this route. A 403 would
    // mean every genuine one-click unsubscribe is now broken.
    const post = await request.post("/api/alerts/unsubscribe?token=zz-definitely-not-a-real-token");
    expect(post.status(), "the token check must be what answers here, not an origin gate").toBe(
      404,
    );
    expect((await post.json()).unsubscribed).toBe(false);

    // The body-encoded form providers may use instead of the query param.
    const posted = await request.post("/api/alerts/unsubscribe", {
      form: { token: "zz-definitely-not-a-real-token" },
    });
    expect(posted.status()).toBe(404);

    // And the human click — a top-level navigation from a mail client,
    // which likewise carries no Origin.
    const get = await request.get("/api/alerts/unsubscribe?token=zz-definitely-not-a-real-token");
    expect(get.status()).toBe(404);
    expect(await get.text()).toContain("Link not recognized");
  });
});

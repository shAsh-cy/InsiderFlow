import { expect, test } from "@playwright/test";

/**
 * CVE-2025-29927 — THE MIDDLEWARE BYPASS.
 *
 * The bug: Next.js used `x-middleware-subrequest` to recognise a request it
 * had made to itself, so that middleware would not re-enter and loop. An
 * external request could set the same header, and Next believed it and
 * skipped middleware. Any application that put authorization in middleware
 * had it walked straight past.
 *
 * Two separate claims are asserted here, and they are separate on purpose,
 * because only one of them is load-bearing:
 *
 *   1. THE REAL DEFENCE — authorization does not live in middleware. This
 *      app's middleware refreshes a Supabase session cookie and nothing
 *      else. `/api/me/*` returns 401 from inside the route handler, so an
 *      attacker who skips middleware skips a cookie refresh and arrives at
 *      the same closed door. That is asserted directly: the protected
 *      endpoint is 401 WITH the spoofed header, and `/api/*` is outside
 *      the middleware matcher entirely, so that 401 cannot be coming from
 *      middleware.
 *
 *   2. THE GUARD — middleware rejects the forged header with 400. Worth
 *      being honest about: on a VULNERABLE Next this check never runs,
 *      because skipping middleware is precisely what the exploit does. It
 *      is a signal, and it is a guard for self-hosters — Vercel strips the
 *      header at its edge, which is why the advisory lists Vercel-hosted
 *      apps as unaffected, and a contributor running `docker compose` or a
 *      VPS behind their own nginx gets no such help.
 *
 * ── WHY THIS FILE IS SHAPED THE WAY IT IS ─────────────────────────────
 *
 * An earlier revision of this project shipped a "forged token" test that
 * never forged anything — it asserted a rejection that would have happened
 * anyway, so it passed whether or not the control existed. A security test
 * that cannot tell those two states apart is worse than no test, because
 * it is reported as coverage.
 *
 * So every case here is a PAIR. The same URL is requested with and without
 * the header, and both outcomes are asserted. If the guard is deleted, the
 * with-header request returns what the without-header request returns and
 * this file goes red. If the guard became a blanket "reject everything",
 * the without-header request goes red instead. Neither failure mode can
 * hide behind the other.
 */

/**
 * The header name, spelled out here rather than imported.
 *
 * Importing the constant from the implementation would make a typo in the
 * implementation invisible: the test would send whatever the guard checks
 * for, and agree with itself. This is the string from the advisory.
 */
const HEADER = "x-middleware-subrequest";

/**
 * Payloads seen in the wild and in the published proofs of concept. The
 * guard matches on PRESENCE rather than value, and these exist to prove
 * that — a guard keyed to one spelling is a guard against one exploit.
 */
const SPOOF_VALUES = [
  "middleware",
  "src/middleware",
  // The variant tuned to path depth: the original check counted repetitions
  // against the route's segment count.
  "middleware:middleware:middleware:middleware:middleware",
];

test.describe("CVE-2025-29927: the forged middleware-subrequest header", () => {
  test("a page route is 200 without the header and 400 with it", async ({ request }) => {
    // (b) The control case FIRST. If this is not 200, the rejection below
    //     proves nothing — the route could be broken for another reason.
    const clean = await request.get("/trades");
    expect(clean.status(), "/trades is reachable without the header").toBe(200);

    for (const value of SPOOF_VALUES) {
      // (a) The exact header, sent verbatim, named in the failure message
      //     so a red run says which spelling got through.
      const spoofed = await request.get("/trades", { headers: { [HEADER]: value } });

      // (c) …and the rejection.
      expect(spoofed.status(), `${HEADER}: ${value} was not rejected`).toBe(400);

      // The server naming the header back is the proof it actually arrived:
      // a 400 alone could be a coincidence of some other validation.
      const body = await spoofed.json();
      expect(body.error.code).toBe("forbidden_internal_header");
      expect(body.error.message).toContain(HEADER);
    }
  });

  test("the header is matched by name, not by case, and not by prefix", async ({ request }) => {
    // HTTP header names are case-insensitive, so a guard that lowercases
    // its own constant and then compares against a raw key is a guard an
    // attacker steps around with the shift key.
    const upper = await request.get("/trades", {
      headers: { "X-MIDDLEWARE-SUBREQUEST": "middleware" },
    });
    expect(upper.status(), "an upper-cased header name must not slip through").toBe(400);

    const mixed = await request.get("/trades", {
      headers: { "X-Middleware-Subrequest": "middleware" },
    });
    expect(mixed.status(), "a mixed-case header name must not slip through").toBe(400);

    // …and the other direction: the guard must not be a substring match
    // that rejects unrelated traffic. A control that blocks everything is
    // indistinguishable from a working one until it takes the site down.
    const neighbour = await request.get("/trades", {
      headers: { "x-middleware-subrequest-not-a-real-header": "middleware" },
    });
    expect(neighbour.status(), "an unrelated header must be ignored").toBe(200);
  });

  test("repeating the header does not slip past the check", async ({ request }) => {
    // Sent as an array, which the Fetch spec joins with ", " into a single
    // field value. Asserted because the joined form is a different string
    // from any single payload, and a value-matching guard would miss it.
    const repeated = await request.get("/trades", {
      headers: { [HEADER]: ["middleware", "middleware", "src/middleware"].join(", ") },
    });
    expect(repeated.status(), "a repeated header must not slip through").toBe(400);
  });

  test("the protected API is 401 with the spoofed header, from the handler", async ({
    request,
  }) => {
    // THE CLAIM THAT MATTERS. `/api/*` is excluded from the middleware
    // matcher, so nothing in middleware — including the guard above — runs
    // for this request. The 401 can only be coming from inside the route
    // handler, which is exactly the property that made this application
    // unexploitable before the guard existed.
    const clean = await request.get("/api/me/watchlist");
    expect(clean.status(), "signed-out watchlist is 401").toBe(401);
    expect((await clean.json()).error.code).toBe("unauthorized");

    for (const value of SPOOF_VALUES) {
      const spoofed = await request.get("/api/me/watchlist", { headers: { [HEADER]: value } });
      expect(spoofed.status(), `${HEADER}: ${value} reached protected data`).toBe(401);
      // Same 401 as the clean request — NOT the middleware's 400. If this
      // ever returns 400, the matcher has changed and this test is no
      // longer proving the data layer holds on its own.
      expect((await spoofed.json()).error.code).toBe("unauthorized");
    }
  });

  test("middleware still does no authorization, which is why the bypass is empty", async ({
    request,
  }) => {
    // Stated as a test rather than a comment: if somebody ever moves a
    // redirect or a role check into middleware, the bypass stops being
    // harmless and this file's whole argument collapses. A public page
    // must be reachable with no cookies at all, and a protected API must
    // be refused — both without middleware having an opinion.
    const publicPage = await request.get("/leaderboard");
    expect(publicPage.status(), "public routes are public").toBe(200);

    const protectedApi = await request.get("/api/me/alert-rules");
    expect(protectedApi.status(), "protected routes refuse in the handler").toBe(401);
  });
});

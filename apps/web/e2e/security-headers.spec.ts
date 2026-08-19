import { expect, test } from "@playwright/test";

import { SECURITY_HEADERS } from "../src/lib/security/headers";

/**
 * THE SECURITY HEADERS, over real responses.
 *
 * This file exists because the headers did not. They were recorded as
 * "already in place" going into this round; a check against the running
 * production build found Content-Security-Policy and nothing else. A
 * control nobody asserts is a control nobody notices the absence of.
 *
 * The routes below are deliberately of DIFFERENT KINDS, because that is
 * where header coverage actually goes wrong: the middleware matcher
 * excludes `/api/*` and `_next/static`, so anything set there covers
 * documents only. A JSON response that can be sniffed as script, or a
 * static chunk served without HSTS, is the gap this samples for.
 */
const ROUTES = [
  { path: "/", kind: "landing (dynamic document)" },
  { path: "/trades", kind: "data page" },
  { path: "/design", kind: "static-ish document" },
  { path: "/api/health", kind: "JSON API — outside the middleware matcher" },
  { path: "/api/trades?limit=1", kind: "JSON API with query" },
  { path: "/.well-known/security.txt", kind: "static route handler" },
];

test.describe("security headers", () => {
  for (const { path, kind } of ROUTES) {
    test(`every constant header is present on ${path} — ${kind}`, async ({ request }) => {
      const headers = (await request.get(path)).headers();
      for (const { key, value, reason } of SECURITY_HEADERS) {
        expect(headers[key.toLowerCase()], `${path} is missing ${key} — ${reason}`).toBe(value);
      }
    });
  }

  test("HSTS is long-lived and covers subdomains", async ({ request }) => {
    // Asserted on the PARSED value, not by string equality with the
    // constant, so that shortening max-age to a token 60 seconds — which
    // looks like a real HSTS header and protects nobody — fails here.
    const hsts = (await request.get("/trades")).headers()["strict-transport-security"] ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
    expect(
      maxAge,
      "a short max-age leaves a window open on every return visit",
    ).toBeGreaterThanOrEqual(31_536_000);
    expect(hsts).toContain("includeSubDomains");
    // `preload` is a deliberate omission — see the note in headers.ts. If
    // somebody adds it, that is a decision that should be made on purpose,
    // and this is where they find out it was already considered.
    expect(hsts, "preload is deliberately not set; see lib/security/headers.ts").not.toContain(
      "preload",
    );
  });

  test("the framing controls agree with each other", async ({ request }) => {
    // Two headers saying different things about framing is worse than one
    // saying nothing: which one applies depends on the browser.
    const headers = (await request.get("/trades")).headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("the JSON API cannot be sniffed into script", async ({ request }) => {
    const response = await request.get("/api/trades?limit=1");
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(
      response.headers()["x-content-type-options"],
      "without nosniff a browser may execute a JSON body it decides looks like script",
    ).toBe("nosniff");
  });

  test("the referrer policy keeps same-origin referrers, which the CSRF gate depends on", async ({
    request,
  }) => {
    // `no-referrer` would be stricter and would break the Referer fallback
    // in lib/security/csrf.ts for clients that suppress Origin. The value
    // is a pair with that gate, so it is asserted as one.
    expect((await request.get("/trades")).headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });
});

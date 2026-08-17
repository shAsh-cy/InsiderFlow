import { describe, expect, it } from "vitest";

import { allowedOriginsForRequest, isSameOriginRequest } from "./csrf";

/**
 * The same-origin decision, in the shapes a real caller produces.
 *
 * The e2e spec proves the decision is WIRED to all eight cookie-
 * authenticated mutating handlers — seven on `/api/me/*` (watchlist POST
 * and DELETE, alert-rules POST, PATCH and DELETE, channels POST and
 * PATCH) plus `POST /auth/signout` — and that a refusal is a 403 rather
 * than a 500 or a silent 200. It cannot cover the interesting inputs:
 * `Origin: null`, an empty header, a lookalike domain, a scheme
 * downgrade. Those are header values, and constructing them as strings is
 * honest — persuading Chromium to emit each one on demand is not
 * something a suite can do reliably.
 *
 * Every group below is a PAIR: the same input shape accepted and
 * refused. A regression that made this function always-true or
 * always-false cannot leave this file green, which is the property the
 * teeth-check in the task exists to demonstrate.
 */

const SITE = "https://insiderflow.dev";
const ALLOWED = [SITE];

describe("isSameOriginRequest — Origin present", () => {
  it("accepts the exact origin", () => {
    expect(isSameOriginRequest(SITE, null, ALLOWED)).toBe(true);
  });

  it("accepts it with the default port spelled out, because a URL parser normalises that", () => {
    // Not laxity: `https://insiderflow.dev:443` IS the same origin per the
    // URL spec, and a string compare would have refused it.
    expect(isSameOriginRequest("https://insiderflow.dev:443", null, ALLOWED)).toBe(true);
    expect(isSameOriginRequest("http://localhost:80", null, ["http://localhost"])).toBe(true);
  });

  it("refuses a different scheme", () => {
    // The downgrade case. An attacker who can serve plaintext on the same
    // host must not be able to write through the https session.
    expect(isSameOriginRequest("http://insiderflow.dev", null, ALLOWED)).toBe(false);
    expect(isSameOriginRequest("https://localhost:3100", null, ["http://localhost:3100"])).toBe(
      false,
    );
  });

  it("refuses a different port", () => {
    expect(isSameOriginRequest("https://insiderflow.dev:8443", null, ALLOWED)).toBe(false);
    // The two ports this repo actually binds — the dev server and the
    // production server the e2e suite drives. Same host, same scheme.
    expect(isSameOriginRequest("http://localhost:3000", null, ["http://localhost:3100"])).toBe(
      false,
    );
  });

  it("refuses lookalike domains that a prefix or suffix check would pass", () => {
    // Each of these is a real bug someone has shipped. `startsWith` passes
    // the first three; `endsWith` passes the fourth and fifth; `includes`
    // passes every one of them.
    for (const lookalike of [
      "https://insiderflow.dev.evil.example",
      "https://insiderflow.dev.co",
      "https://insiderflow.devious.example",
      "https://evil-insiderflow.dev",
      "https://notinsiderflow.dev",
      "https://www.insiderflow.dev",
      "https://api.insiderflow.dev",
      "https://insiderflow.dev@evil.example",
      "https://evil.example/https://insiderflow.dev",
      "https://evil.example/?x=https://insiderflow.dev",
      "https://evil.example#https://insiderflow.dev",
    ]) {
      expect(isSameOriginRequest(lookalike, null, ALLOWED), lookalike).toBe(false);
    }
  });

  it("refuses a malformed Origin", () => {
    for (const malformed of [
      "not-a-url",
      // No scheme — the spelling a hand-written allowlist or a hand-set
      // header most often gets wrong.
      "insiderflow.dev",
      "//insiderflow.dev",
      "https://",
      "https:///settings",
      " ",
    ]) {
      expect(isSameOriginRequest(malformed, null, ALLOWED), JSON.stringify(malformed)).toBe(false);
    }
  });

  it("refuses the opaque origin a browser spells `null`", () => {
    // Sent for sandboxed iframes and `data:` documents. The literal string
    // is also what `URL.origin` returns for an opaque origin, so a naive
    // implementation can end up comparing "null" to "null" and agreeing.
    expect(isSameOriginRequest("null", null, ALLOWED)).toBe(false);
    expect(isSameOriginRequest("null", null, ["null"])).toBe(false);
  });

  it("does not fall back to Referer when Origin is present and wrong", () => {
    // The downgrade an attacker would reach for: send a junk or hostile
    // Origin and be judged on the header they have more influence over.
    expect(isSameOriginRequest("https://evil.example", `${SITE}/settings`, ALLOWED)).toBe(false);
    expect(isSameOriginRequest("not-a-url", `${SITE}/settings`, ALLOWED)).toBe(false);
    // An Origin header sent EMPTY is malformed, not missing.
    expect(isSameOriginRequest("", `${SITE}/settings`, ALLOWED)).toBe(false);
  });
});

describe("isSameOriginRequest — Origin absent, Referer present", () => {
  it("accepts when the referer's ORIGIN matches, whatever its path", () => {
    for (const referer of [
      SITE,
      `${SITE}/`,
      `${SITE}/settings`,
      `${SITE}/stock/AAPL?tab=insiders#top`,
      "https://insiderflow.dev:443/settings",
    ]) {
      expect(isSameOriginRequest(null, referer, ALLOWED), referer).toBe(true);
    }
  });

  it("refuses when the referer's origin does not match", () => {
    for (const referer of [
      "https://evil.example/page",
      "https://evil-insiderflow.dev/page",
      // The one a path-based check falls for: our origin appears in the
      // URL, but the ORIGIN is the attacker's.
      `https://evil.example/${SITE}/settings`,
      `https://evil.example/?next=${SITE}`,
      "http://insiderflow.dev/settings",
      "https://insiderflow.dev:8443/settings",
    ]) {
      expect(isSameOriginRequest(null, referer, ALLOWED), referer).toBe(false);
    }
  });

  it("refuses a malformed referer", () => {
    for (const referer of ["not-a-url", "/settings", "", " "]) {
      expect(isSameOriginRequest(null, referer, ALLOWED), JSON.stringify(referer)).toBe(false);
    }
  });
});

describe("isSameOriginRequest — neither header", () => {
  it("refuses", () => {
    // THE RULE THE WHOLE CHECK RESTS ON. A browser sends Origin on every
    // POST/PATCH/DELETE, same-origin ones included, so "neither header"
    // is never legitimate browser traffic to these routes. Accepting it
    // would leave the check trivially bypassable by anything that is not
    // a browser — and would make every other assertion in this file
    // decorative, because an attacker's fetch could simply be judged on
    // the branch that says yes.
    expect(isSameOriginRequest(null, null, ALLOWED)).toBe(false);
  });
});

describe("isSameOriginRequest — the allowlist", () => {
  it("refuses everything when the allowlist is empty", () => {
    // Fail closed. The bug this mirrors is `telegram-webhook.ts`'s old
    // `if (configured && …)`, where an unset variable meant "permit".
    expect(isSameOriginRequest(SITE, null, [])).toBe(false);
    expect(isSameOriginRequest(SITE, `${SITE}/settings`, [])).toBe(false);
    expect(isSameOriginRequest(null, null, [])).toBe(false);
  });

  it("refuses everything when every allowlist entry is unparseable", () => {
    // An operator sets SITE_URL to `insiderflow.dev` with no scheme. That
    // must not become an allowlist containing a matchable "null" origin.
    expect(isSameOriginRequest(SITE, null, ["insiderflow.dev", "", "not-a-url"])).toBe(false);
    expect(isSameOriginRequest("null", null, ["insiderflow.dev"])).toBe(false);
  });

  it("accepts any entry in a multi-origin allowlist, and only those", () => {
    const multi = [SITE, "https://www.insiderflow.dev", "http://localhost:3100"];
    expect(isSameOriginRequest(SITE, null, multi)).toBe(true);
    expect(isSameOriginRequest("https://www.insiderflow.dev", null, multi)).toBe(true);
    expect(isSameOriginRequest("http://localhost:3100", null, multi)).toBe(true);
    expect(isSameOriginRequest("https://evil.example", null, multi)).toBe(false);
    expect(isSameOriginRequest("http://localhost:3000", null, multi)).toBe(false);
  });

  it("normalises entries that carry a path, so a sloppy SITE_URL still works", () => {
    // `.env.example` ships `SITE_URL=http://localhost:3000`; a trailing
    // slash or a path is the obvious way for that to drift.
    expect(isSameOriginRequest(SITE, null, [`${SITE}/`])).toBe(true);
    expect(isSameOriginRequest(SITE, null, [`${SITE}/settings`])).toBe(true);
  });
});

/**
 * The allowlist derivation, which is where a wrong answer would either
 * break every write in production or quietly permit an attacker's origin.
 */
describe("allowedOriginsForRequest", () => {
  const withHeaders = (headers: Record<string, string>): Request =>
    new Request("http://0.0.0.0:3000/api/me/watchlist", { method: "POST", headers });

  /** SITE_URL belongs to the SERVER's environment; set it explicitly. */
  const withSiteUrl = <T>(value: string | undefined, body: () => T): T => {
    const previous = process.env.SITE_URL;
    if (value === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = value;
    try {
      return body();
    } finally {
      if (previous === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previous;
    }
  };

  it("derives the request's own origin from Host, so a plain deployment needs no configuration", () => {
    withSiteUrl(undefined, () => {
      const allowed = allowedOriginsForRequest(withHeaders({ host: "insiderflow.dev" }));
      expect(isSameOriginRequest(SITE, null, allowed)).toBe(true);
      expect(isSameOriginRequest("https://evil.example", null, allowed)).toBe(false);
    });
  });

  it("assumes https for a non-loopback Host, which is how a TLS-terminating proxy is reached", () => {
    withSiteUrl(undefined, () => {
      // The scheme is DERIVED, not read from x-forwarded-proto: behind a
      // proxy that preserves Host the origin server sees plain http, and
      // the browser's Origin says https. Guessing gets this right; reading
      // the header would let the caller choose the scheme it is judged on.
      const allowed = allowedOriginsForRequest(withHeaders({ host: "insiderflow.dev" }));
      expect(isSameOriginRequest(SITE, null, allowed)).toBe(true);
      expect(isSameOriginRequest("http://insiderflow.dev", null, allowed)).toBe(false);
    });
  });

  it("IGNORES x-forwarded-host and x-forwarded-proto, which any client can set", () => {
    // THE BYPASS THIS FUNCTION WAS REWRITTEN TO CLOSE. Measured against
    // the running production server before the change: a POST to
    // /api/me/watchlist with a valid session cookie, Origin:
    // https://evil.example, X-Forwarded-Host: evil.example and
    // X-Forwarded-Proto: https answered 200 and wrote the row. Both are
    // ordinary request headers; only `Host` is one script cannot set.
    withSiteUrl(undefined, () => {
      const allowed = allowedOriginsForRequest(
        withHeaders({
          host: "insiderflow.dev",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        }),
      );
      expect(isSameOriginRequest("https://evil.example", null, allowed)).toBe(false);
      // …and the real Host still works, so the refusal above is the
      // forwarded header being ignored and not the derivation collapsing.
      expect(isSameOriginRequest(SITE, null, allowed)).toBe(true);
    });
  });

  it("needs SITE_URL when a proxy rewrites Host, and fails closed until it is set", () => {
    // The cost of ignoring x-forwarded-host, written down as a test so it
    // is a known trade rather than a support ticket. A proxy that puts an
    // internal name in Host and the public one in x-forwarded-host makes
    // this deployment refuse every write…
    const proxied = {
      host: "internal.local:3000",
      "x-forwarded-host": "insiderflow.dev",
      "x-forwarded-proto": "https",
    };
    withSiteUrl(undefined, () => {
      const allowed = allowedOriginsForRequest(withHeaders(proxied));
      expect(isSameOriginRequest(SITE, null, allowed)).toBe(false);
    });
    // …until SITE_URL pins the canonical origin, which is the documented
    // lever and the only configuration surface this repo defines.
    withSiteUrl(SITE, () => {
      const allowed = allowedOriginsForRequest(withHeaders(proxied));
      expect(isSameOriginRequest(SITE, null, allowed)).toBe(true);
      // The internal address the proxy forwarded FROM is not a browser
      // origin and must not become one either way.
      expect(isSameOriginRequest("http://internal.local:3000", null, allowed)).toBe(false);
    });
  });

  it("keeps localhost on http, which is how the dev and e2e servers are reached", () => {
    withSiteUrl(undefined, () => {
      const allowed = allowedOriginsForRequest(withHeaders({ host: "localhost:3100" }));
      expect(isSameOriginRequest("http://localhost:3100", null, allowed)).toBe(true);
      expect(isSameOriginRequest("http://localhost:3000", null, allowed)).toBe(false);
    });
  });

  it("adds SITE_URL alongside the request origin rather than instead of it", () => {
    withSiteUrl("https://pinned.insiderflow.dev", () => {
      const allowed = allowedOriginsForRequest(withHeaders({ host: "insiderflow.dev" }));
      expect(isSameOriginRequest("https://pinned.insiderflow.dev", null, allowed)).toBe(true);
      expect(isSameOriginRequest(SITE, null, allowed)).toBe(true);
      expect(isSameOriginRequest("https://evil.example", null, allowed)).toBe(false);
    });
  });

  it("never admits an origin that a header a PAGE can set put there", () => {
    // The catch-all, and its scope is now the claim it can actually make.
    // The version this replaces said "whatever the derivation does with a
    // hostile or absent Host, evil.example must not end up in the set" —
    // and then exercised three shapes that all pointed x-forwarded-host at
    // the REAL site. The dangerous direction was the one case it did not
    // cover, and at the time it would have failed.
    //
    // Every case below sends a hostile value in a header that is either
    // absent, ignored, or not attributable to the browser. `Host` itself
    // is covered separately, immediately after.
    const cases: Array<Record<string, string>> = [
      {},
      { host: "0.0.0.0:3000" },
      { "x-forwarded-host": "evil.example" },
      { host: "insiderflow.dev", "x-forwarded-host": "evil.example" },
      { host: "insiderflow.dev", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      { host: "insiderflow.dev", "x-forwarded-proto": "https", origin: "https://evil.example" },
      { host: "0.0.0.0:3000", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      { host: "insiderflow.dev", "x-forwarded-host": "evil.example:443" },
      { host: "insiderflow.dev", forwarded: "host=evil.example;proto=https" },
      { host: "insiderflow.dev", "x-original-host": "evil.example" },
      { host: "insiderflow.dev", referer: "https://evil.example/page" },
    ];
    for (const headers of cases) {
      withSiteUrl(undefined, () => {
        const allowed = allowedOriginsForRequest(withHeaders(headers));
        expect(
          isSameOriginRequest("https://evil.example", null, allowed),
          JSON.stringify(headers),
        ).toBe(false);
        expect(
          isSameOriginRequest("http://evil.example", null, allowed),
          JSON.stringify(headers),
        ).toBe(false);
        expect(isSameOriginRequest(null, null, allowed), JSON.stringify(headers)).toBe(false);
      });
      // The same hostile headers must not defeat a pinned SITE_URL either.
      withSiteUrl(SITE, () => {
        const allowed = allowedOriginsForRequest(withHeaders(headers));
        expect(
          isSameOriginRequest("https://evil.example", null, allowed),
          `SITE_URL pinned, ${JSON.stringify(headers)}`,
        ).toBe(false);
      });
    }
  });

  it("does admit a forged Host — the residual, which only a non-browser can reach", () => {
    // Written as an assertion rather than a comment because it is the one
    // thing the derivation genuinely trusts, and a reader deserves to see
    // its exact size. `Host` is a FORBIDDEN header name: script cannot set
    // it, so on any request a browser makes it names the site being
    // attacked. curl can say anything — and gains nothing, because to
    // attack it would first need the session cookie, and a caller holding
    // that can simply make the request instead of forging an origin.
    //
    // If this ever goes red, someone has hardened the derivation further.
    // That is a good change; update this test, do not revert it.
    withSiteUrl(undefined, () => {
      const allowed = allowedOriginsForRequest(withHeaders({ host: "evil.example" }));
      expect(isSameOriginRequest("https://evil.example", null, allowed)).toBe(true);
      // Even then it is only THAT origin: a forged Host names one origin,
      // it does not open the allowlist.
      expect(isSameOriginRequest("https://other.example", null, allowed)).toBe(false);
      expect(isSameOriginRequest("http://evil.example", null, allowed)).toBe(false);
    });
  });
});

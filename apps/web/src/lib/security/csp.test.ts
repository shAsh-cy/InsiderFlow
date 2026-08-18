import { describe, expect, it } from "vitest";

import {
  CSP_ENFORCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
  buildCsp,
  createNonce,
  isLoopbackHost,
  shouldSendCsp,
} from "./csp";

const parse = (policy: string): Map<string, string> =>
  new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name ?? "", values.join(" ")];
    }),
  );

const policy = (overrides: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
  buildCsp({ nonce: "TESTNONCE", supabaseOrigin: null, upgradeInsecure: false, ...overrides });

describe("buildCsp — script-src, which is the directive that matters", () => {
  it("carries the nonce and strict-dynamic", () => {
    const scriptSrc = parse(policy()).get("script-src") ?? "";
    expect(scriptSrc).toContain("'nonce-TESTNONCE'");
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("never permits inline or eval'd script", () => {
    const built = policy();
    const directives = parse(built);
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    // `'unsafe-eval'` must not appear anywhere at all — no directive in
    // this app has a use for it.
    expect(built).not.toContain("'unsafe-eval'");
    // `'unsafe-inline'` appears EXACTLY once, in style-src, and that is
    // the whole of the concession. A second occurrence means a later
    // edit widened the policy, most likely onto scripts.
    expect(built.match(/'unsafe-inline'/g) ?? []).toHaveLength(1);
    expect(directives.get("style-src")).toContain("'unsafe-inline'");
  });

  it("keeps 'self' alongside strict-dynamic for CSP2 browsers", () => {
    // A CSP3 browser ignores host-sources once strict-dynamic is present;
    // a CSP2 browser ignores strict-dynamic. Dropping 'self' would leave
    // the older one with a policy that blocks the whole app.
    expect(parse(policy()).get("script-src")).toContain("'self'");
  });
});

describe("buildCsp — the rest of the policy", () => {
  it("locks down the directives that cost nothing", () => {
    const directives = parse(policy());
    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'self'");
    expect(directives.get("frame-ancestors")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'self'");
  });

  it("allows the Supabase origin to be reached, over https and wss", () => {
    const connect = parse(policy({ supabaseOrigin: "https://abc.supabase.co" })).get("connect-src");
    expect(connect).toContain("https://abc.supabase.co");
    // Realtime upgrades the connection; a connect-src covering only https
    // turns that into a reconnect loop nobody attributes to the CSP.
    expect(connect).toContain("wss://abc.supabase.co");
  });

  it("does not name an origin when auth is unconfigured", () => {
    expect(parse(policy()).get("connect-src")).toBe("'self'");
  });

  it("keeps frame-src closed unless Turnstile is configured", () => {
    // `frame-src` does not fall back to default-src, so naming it is what
    // makes "no iframes" a stated decision instead of a default nobody
    // checked. Enabling the captcha opens exactly one origin.
    expect(parse(policy()).get("frame-src")).toBe("'none'");
    expect(parse(policy({ turnstile: true })).get("frame-src")).toBe(
      "https://challenges.cloudflare.com",
    );
  });

  it("does not widen script-src for Turnstile, because strict-dynamic already covers it", () => {
    // The widget script is injected by our own nonce'd bundle, and
    // 'strict-dynamic' propagates trust to what a trusted script loads.
    // Adding the host would be redundant on CSP3 and would weaken the
    // policy for a CSP2 browser, which ignores strict-dynamic and honours
    // the host list.
    const scriptSrc = parse(policy({ turnstile: true })).get("script-src") ?? "";
    expect(scriptSrc).not.toContain("challenges.cloudflare.com");
  });

  it("adds upgrade-insecure-requests only when asked", () => {
    expect(policy({ upgradeInsecure: true })).toContain("upgrade-insecure-requests");
    expect(policy({ upgradeInsecure: false })).not.toContain("upgrade-insecure-requests");
  });

  it("names every directive exactly once", () => {
    // A repeated directive is not an error in CSP — the FIRST occurrence
    // wins and the rest are ignored — so a duplicate silently discards
    // whichever version somebody meant.
    const names = policy({ supabaseOrigin: "https://abc.supabase.co", upgradeInsecure: true })
      .split(";")
      .map((part) => part.trim().split(/\s+/)[0]);
    expect(names).toHaveLength(new Set(names).size);
  });
});

describe("createNonce", () => {
  it("is 128 bits of base64", () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it("differs every time, which is the entire property", () => {
    const nonces = new Set(Array.from({ length: 500 }, () => createNonce()));
    expect(nonces.size).toBe(500);
  });
});

describe("shouldSendCsp", () => {
  it("sends one for an ordinary document request", () => {
    expect(shouldSendCsp(new Headers())).toBe(true);
    expect(shouldSendCsp(new Headers({ accept: "text/html" }))).toBe(true);
  });

  it.each([
    ["next-router-prefetch", "1"],
    ["next-router-segment-prefetch", "/trades"],
    ["rsc", "1"],
  ])("skips %s requests", (header, value) => {
    // A prefetched document is replayed by the client router later,
    // against a different response's policy — its scripts would be
    // refused, and only on links the router happened to prefetch.
    expect(shouldSendCsp(new Headers({ [header]: value }))).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3100", "[::1]", "[::1]:3100"])(
    "recognises %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["insiderflow.dev", "localhost.evil.example", "127.0.0.1.evil.example", "", null])(
    "does not mistake %s for loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("header names", () => {
  it("are the two the spec defines, spelled correctly", () => {
    // A typo here is a policy that never applies and never errors.
    expect(CSP_ENFORCE_HEADER).toBe("Content-Security-Policy");
    expect(CSP_REPORT_ONLY_HEADER).toBe("Content-Security-Policy-Report-Only");
  });
});

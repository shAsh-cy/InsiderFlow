import { describe, expect, it } from "vitest";

import { DEFAULT_POST_LOGIN_PATH, requestOrigin, safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("keeps an ordinary same-origin path", () => {
    expect(safeRedirectPath("/settings")).toBe("/settings");
    expect(safeRedirectPath("/stock/ZZNOVA?tab=insiders")).toBe("/stock/ZZNOVA?tab=insiders");
    expect(safeRedirectPath("/docs/methodology#scoring")).toBe("/docs/methodology#scoring");
  });

  it("falls back when there is nothing to redirect to", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeRedirectPath("")).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  // Each of these reaches an attacker's page from the highest-trust moment in
  // the session — the instant after the user authenticates.
  it.each([
    ["absolute https", "https://evil.example"],
    ["absolute http", "http://evil.example/pay"],
    ["protocol-relative", "//evil.example"],
    ["backslash protocol-relative", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["scheme with leading whitespace", " https://evil.example"],
    ["newline smuggling", "/ok\nLocation: https://evil.example"],
    ["tab smuggling", "/ok\thttps://evil.example"],
    ["relative, no leading slash", "settings"],
    ["parent-relative", "../../evil"],
    ["userinfo trick", "https://insiderflow.dev@evil.example"],
  ])("rejects %s", (_label, hostile) => {
    expect(safeRedirectPath(hostile)).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it("normalises rather than trusting the input verbatim", () => {
    // The value that comes back is what the URL parser produced, so a caller
    // cannot smuggle anything past this function by relying on a later parse
    // disagreeing with this one.
    expect(safeRedirectPath("/a/../b")).toBe("/b");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/")).toBe("/");
  });
});

describe("requestOrigin", () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("echoes the host the client actually asked for", () => {
    expect(
      requestOrigin(req("http://0.0.0.0:3000/auth/callback", { host: "localhost:3000" })),
    ).toBe("http://localhost:3000");
  });

  it("never emits the bound address", () => {
    // `new URL(request.url).origin` returned http://0.0.0.0:3000 inside the
    // Docker image, and every browser refused it with ERR_ADDRESS_INVALID —
    // so sign-in and sign-out both dead-ended on a redirect.
    const origin = requestOrigin(
      req("http://0.0.0.0:3000/auth/callback", { host: "insiderflow.example" }),
    );
    expect(origin).not.toContain("0.0.0.0");
    expect(origin).toBe("https://insiderflow.example");
  });

  it("prefers the proxy's view of the public origin", () => {
    // Behind TLS termination the origin server sees http on an internal name;
    // only the proxy knows the user is on https at the public host.
    expect(
      requestOrigin(
        req("http://10.0.0.7:3000/auth/callback", {
          host: "10.0.0.7:3000",
          "x-forwarded-host": "insiderflow.dev",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://insiderflow.dev");
  });

  it("keeps http for loopback so local development is not broken", () => {
    expect(requestOrigin(req("http://127.0.0.1:3000/x", { host: "127.0.0.1:3000" }))).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("falls back to SITE_URL when there is no usable host header", () => {
    const previous = process.env.SITE_URL;
    process.env.SITE_URL = "https://configured.example/";
    try {
      expect(requestOrigin(req("http://0.0.0.0:3000/x", { host: "0.0.0.0:3000" }))).toBe(
        "https://configured.example",
      );
    } finally {
      if (previous === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previous;
    }
  });
});

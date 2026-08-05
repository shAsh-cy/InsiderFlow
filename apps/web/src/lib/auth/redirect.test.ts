import { describe, expect, it } from "vitest";

import { DEFAULT_POST_LOGIN_PATH, safeRedirectPath } from "./redirect";

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

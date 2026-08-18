import { afterEach, describe, expect, it, vi } from "vitest";

import { captchaOption, isTurnstileEnabled, turnstileSiteKey } from "./turnstile";

/**
 * The half of Turnstile that lives in this repository is small on purpose:
 * a public site key, and whether to attach a token. Supabase does the
 * verification, so what is worth testing here is that "not configured" is
 * a clean, supported state rather than a broken one — because that is how
 * every fresh clone, every CI run and the whole e2e suite executes.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("turnstileSiteKey", () => {
  it("is null when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBeNull();
    expect(isTurnstileEnabled()).toBe(false);
  });

  it("is null for whitespace, which is what a half-filled .env looks like", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "   ");
    expect(turnstileSiteKey()).toBeNull();
  });

  it("is the key when set", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAA_site_key");
    expect(turnstileSiteKey()).toBe("0x4AAAAAAA_site_key");
    expect(isTurnstileEnabled()).toBe(true);
  });
});

describe("captchaOption", () => {
  it("is an EMPTY object when Turnstile is off, not { captchaToken: undefined }", () => {
    // The distinction is not pedantry. supabase-js serialises the key
    // either way, and a project with captcha enforcement enabled answers a
    // present-but-null token with a different error than a missing one —
    // which is a confusing thing to debug from a log line.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const option = captchaOption("a-token");
    expect(option).toEqual({});
    expect(Object.keys(option)).toEqual([]);
    expect("captchaToken" in option).toBe(false);
  });

  it("is empty when enabled but the widget has not solved yet", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAA_site_key");
    expect(captchaOption(null)).toEqual({});
  });

  it("carries the token when enabled and solved", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAA_site_key");
    expect(captchaOption("solved-token")).toEqual({ captchaToken: "solved-token" });
  });

  it("spreads cleanly into an auth options object either way", () => {
    // The call-site property: `{ ...base, ...captchaOption(t) }` must not
    // introduce a key when Turnstile is off.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect({ emailRedirectTo: "https://x/y", ...captchaOption("t") }).toEqual({
      emailRedirectTo: "https://x/y",
    });
  });
});

import { describe, expect, it } from "vitest";

import { accountState } from "./account-state";

describe("accountState", () => {
  it("advertises nothing where auth is not configured", () => {
    // An affordance that cannot work is worse than a missing one.
    expect(accountState({ userId: null, email: null, authConfigured: false })).toBe("none");
    expect(accountState({ userId: "u1", email: "a@b.c", authConfigured: false })).toBe("none");
    expect(accountState(undefined)).toBe("none");
  });

  it("offers a plain sign-in link when nobody is signed in", () => {
    // Plain, and that is the whole of Item B on this control: a signed-out
    // reader gets a link, so no overlay primitive and no auth SDK is in
    // their first-load graph.
    expect(accountState({ userId: null, email: null, authConfigured: true })).toBe("sign-in");
  });

  it("draws the chip only for a session the server resolved", () => {
    expect(accountState({ userId: "u1", email: "a@b.c", authConfigured: true })).toBe("account");
  });

  it("treats a cookie that did not resolve to a user as signed out", () => {
    // The case that matters. `getSessionUser()` returns null for an
    // expired, forged or otherwise unverifiable cookie, and that has to
    // land on "sign-in" rather than on a chip belonging to nobody. The
    // e2e counterpart plants such a cookie and checks the rendered bar.
    expect(accountState({ userId: null, email: "stale@example.com", authConfigured: true })).toBe(
      "sign-in",
    );
  });
});

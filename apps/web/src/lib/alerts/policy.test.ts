import { describe, expect, it } from "vitest";

import { defaultAlertMode } from "./policy";

describe("defaultAlertMode", () => {
  it("fires instantly when only unmetered channels are selected", () => {
    // The digest exists to protect the Resend free tier. Telegram is free and
    // unlimited, so batching a Telegram-only rule buys nothing and costs
    // latency — this was the bug behind "I saved a screen and got no alert".
    expect(defaultAlertMode(["telegram"])).toBe("instant");
    expect(defaultAlertMode(["webpush"])).toBe("instant");
    expect(defaultAlertMode(["telegram", "webpush"])).toBe("instant");
  });

  it("batches as soon as email is involved", () => {
    expect(defaultAlertMode(["email"])).toBe("digest");
    expect(defaultAlertMode(["telegram", "email"])).toBe("digest");
  });

  it("defaults to instant for an empty selection", () => {
    // No metered channel present, so nothing to conserve.
    expect(defaultAlertMode([])).toBe("instant");
  });
});

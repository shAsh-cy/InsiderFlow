import { describe, expect, it } from "vitest";

import { isAuthorizedTelegramUpdate } from "./telegram-webhook";

/**
 * The Telegram webhook's authentication decision, in BOTH deployment
 * modes, without standing up two servers.
 *
 * What is at stake: `completeTelegramLink` binds a chat id to whichever
 * account generated the link token, so an unauthenticated caller who can
 * post updates here gets a stranger's alert stream delivered to their own
 * chat.
 *
 * Every case is a pair — the same input shape accepted and refused — so a
 * regression that made the check always-true or always-false cannot leave
 * this file green.
 */
const SECRET = "cQ8v3nZ1sT7pXk2LmR9wJb4hY6dA0eGu";

describe("isAuthorizedTelegramUpdate — webhook-configured mode", () => {
  it("accepts the exact secret", () => {
    expect(isAuthorizedTelegramUpdate(SECRET, SECRET)).toBe(true);
  });

  it("refuses a wrong one, including near misses", () => {
    for (const wrong of [
      // One byte out at the end — the case a non-constant-time compare
      // would take measurably longer to reject than a first-byte miss.
      `${SECRET.slice(0, -1)}X`,
      // …and at the start.
      `X${SECRET.slice(1)}`,
      SECRET.toUpperCase(),
      SECRET.toLowerCase(),
      `${SECRET} `,
      ` ${SECRET}`,
      SECRET.slice(0, 16),
      `${SECRET}${SECRET}`,
      "",
    ]) {
      expect(isAuthorizedTelegramUpdate(wrong, SECRET), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("refuses an absent header", () => {
    // A caller that sends no header at all, which is what an attacker who
    // has found the URL but not the secret actually does.
    expect(isAuthorizedTelegramUpdate(null, SECRET)).toBe(false);
  });
});

describe("isAuthorizedTelegramUpdate — outbound-only mode", () => {
  /**
   * How the local stack and any deployment that never ran `setWebhook`
   * runs: alerts go OUT, nothing legitimate comes in. The bug this
   * replaces was `if (configured && …)`, which turned exactly this
   * configuration into an open endpoint.
   */
  it("refuses every update when no secret is configured", () => {
    for (const configured of [undefined, ""]) {
      expect(isAuthorizedTelegramUpdate(SECRET, configured), `configured=${configured}`).toBe(
        false,
      );
      expect(isAuthorizedTelegramUpdate(null, configured)).toBe(false);
      expect(isAuthorizedTelegramUpdate("", configured)).toBe(false);
      // The header an attacker would guess hardest at is still refused —
      // there is nothing to match against, so nothing can match.
      expect(isAuthorizedTelegramUpdate("anything", configured)).toBe(false);
    }
  });

  it("does not accept a caller who presents nothing against nothing", () => {
    // The subtle one: empty-header against empty-secret is string-equal.
    // If the configured check were removed and only the comparison
    // remained, this would be the way in.
    expect(isAuthorizedTelegramUpdate("", "")).toBe(false);
    expect(isAuthorizedTelegramUpdate(null, "")).toBe(false);
  });
});

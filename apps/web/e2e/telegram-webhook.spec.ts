import { expect, test } from "@playwright/test";

/**
 * THE TELEGRAM WEBHOOK, over a real request.
 *
 * `src/lib/security/telegram-webhook.test.ts` covers the decision in both
 * deployment modes. This file covers the thing a unit test cannot: that
 * the decision is actually WIRED to the route, that a refusal is a 401
 * and not a 500 or a silent 200, and that nothing downstream of the check
 * runs on the way past.
 *
 * ── THE MODE IS DECLARED, NEVER GUESSED ───────────────────────────────
 *
 * The first version of this file inferred the server's mode from the TEST
 * RUNNER's `TELEGRAM_WEBHOOK_SECRET`. Those are two different processes.
 * The server reads `.env.local`, which HAS the secret; the runner's shell
 * did not, so the spec took its "outbound-only" branch and asserted that
 * no header value gets in — which passed, because the values it tried
 * were simply the wrong secret. It was green while proving nothing, and a
 * deliberately reintroduced open-when-unset bug did not move it.
 *
 * So the mode is declared by `TELEGRAM_WEBHOOK_MODE` and the spec holds
 * the declaration to account:
 *
 *   configured    — `TELEGRAM_WEBHOOK_SECRET` must ALSO be given to the
 *                   runner and must be the server's. A matching update is
 *                   accepted; if it is refused, the two disagree and that
 *                   is a failure, not a skip.
 *   outbound-only — the server was started with no secret. NOTHING is
 *                   accepted, including the values a configured server
 *                   would take.
 *   unset         — the runner cannot know, so only the claims that hold
 *                   in BOTH modes are asserted, and the positive case is
 *                   reported as not covered rather than quietly passed.
 */
const MODE = process.env.TELEGRAM_WEBHOOK_MODE ?? "";
const CONFIGURED_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const HEADER = "X-Telegram-Bot-Api-Secret-Token";
const ENDPOINT = "/api/alerts/telegram";

/** A well-formed update, so a refusal cannot be blamed on the body. */
const UPDATE = {
  update_id: 1,
  message: { text: "/start abc123", chat: { id: 424242 } },
};

test.describe("the Telegram webhook", () => {
  test("refuses an update with no secret header", async ({ request }) => {
    const res = await request.post(ENDPOINT, { data: UPDATE });
    expect(res.status(), "an unauthenticated update must be refused").toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  test("refuses a wrong secret, and says nothing about the right one", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      data: UPDATE,
      headers: { [HEADER]: "not-the-secret" },
    });
    expect(res.status()).toBe(401);

    const body = await res.text();
    // The response must not leak the expected value or its length. A
    // handler that echoed "expected 32 characters" would hand an attacker
    // the search space for free.
    expect(body).not.toContain("TELEGRAM");
    if (CONFIGURED_SECRET) expect(body).not.toContain(CONFIGURED_SECRET);
    expect(body.length, "the refusal is a fixed short body").toBeLessThan(200);
  });

  test("refuses a near-miss secret", async ({ request }) => {
    // One byte out. Against a `!==` compare this is the request that takes
    // longest to reject; against the constant-time compare it is
    // indistinguishable from any other wrong value. Asserted here for the
    // outcome; the timing property is asserted structurally in the unit
    // test, because wall-clock timing on a shared runner is noise.
    const near = CONFIGURED_SECRET
      ? `${CONFIGURED_SECRET.slice(0, -1)}X`
      : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaX";
    const res = await request.post(ENDPOINT, { data: UPDATE, headers: { [HEADER]: near } });
    expect(res.status()).toBe(401);
  });

  test("refuses GET regardless of the header", async ({ request }) => {
    // Only POST is exported. A 405 here is the framework refusing, which
    // is fine — what must never happen is a 200.
    const res = await request.get(ENDPOINT, { headers: { [HEADER]: CONFIGURED_SECRET } });
    expect([401, 405]).toContain(res.status());
  });

  test(`the matching case (mode: ${MODE || "undeclared"})`, async ({ request }) => {
    if (MODE === "outbound-only") {
      // The pair to every refusal above: with no secret configured on the
      // SERVER there is no header value that gets in — including the ones
      // a configured deployment would accept. This is the assertion that
      // catches the old `if (configured && …)` bug, which accepted
      // everything in exactly this mode.
      for (const attempt of ["", "secret", "a".repeat(32), CONFIGURED_SECRET || "x"]) {
        const res = await request.post(ENDPOINT, { data: UPDATE, headers: { [HEADER]: attempt } });
        expect(res.status(), `"${attempt}" must not be accepted with no secret configured`).toBe(
          401,
        );
      }
      return;
    }

    if (MODE === "configured") {
      expect(
        CONFIGURED_SECRET,
        "TELEGRAM_WEBHOOK_MODE=configured requires the server's secret in the runner's env",
      ).not.toBe("");

      // THE POSITIVE CASE, which is what stops every assertion above from
      // being satisfied by an endpoint that refuses everything.
      const res = await request.post(ENDPOINT, {
        data: UPDATE,
        headers: { [HEADER]: CONFIGURED_SECRET },
      });
      // A 401 here means the runner's secret is not the server's. That is
      // a failure of the harness, and it must be loud: a silent skip is
      // how the first version of this file stayed green while proving
      // nothing.
      expect(
        res.status(),
        "a genuine update must be accepted — a 401 means the runner and the server hold different secrets",
      ).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      return;
    }

    // UNDECLARED. The runner cannot see the server's environment, so the
    // only honest thing is to assert nothing further and say so.
    test.skip(
      true,
      "TELEGRAM_WEBHOOK_MODE is not set, so the positive case is not covered by this run. " +
        "Set it to `configured` (with TELEGRAM_WEBHOOK_SECRET) or `outbound-only`.",
    );
  });
});

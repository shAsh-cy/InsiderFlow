import { expect, test } from "@playwright/test";

/**
 * The SSE concurrency ceiling.
 *
 * /api/stream is rate-limited per minute like every other route, which bounds
 * how often a client may OPEN a stream — not how many it may hold. Each one
 * occupies a serverless function for up to 25 seconds, so a caller well inside
 * the request limit could still pin an unbounded number of invocations by
 * simply never closing them. On a free tier that is the entire concurrency
 * budget, and it looks like an outage rather than like abuse.
 *
 * Driven from inside the page so the connections are genuinely concurrent and
 * genuinely share one client identity. `fetch` resolves as soon as the headers
 * arrive, so we never have to read a 25-second body.
 */

test("refuses excess concurrent streams with 503 and Retry-After", async ({ page, request }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const controllers: AbortController[] = [];
    try {
      // Comfortably above the default per-client ceiling of 4.
      const attempts = Array.from({ length: 8 }, () => {
        const controller = new AbortController();
        controllers.push(controller);
        return fetch("/api/stream", { signal: controller.signal }).then((r) => ({
          status: r.status,
          retryAfter: r.headers.get("retry-after"),
        }));
      });
      return await Promise.all(attempts);
    } finally {
      // Hand the slots back so the rest of the suite is unaffected.
      for (const controller of controllers) controller.abort();
    }
  });

  const refused = result.filter((r) => r.status === 503);
  const accepted = result.filter((r) => r.status === 200);

  expect(accepted.length, "some streams must still be served").toBeGreaterThan(0);
  expect(refused.length, "the ceiling must actually refuse something").toBeGreaterThan(0);
  // Refusing without saying when to come back turns a soft limit into a hard
  // failure for every well-behaved client.
  for (const r of refused) {
    expect(Number(r.retryAfter)).toBeGreaterThan(0);
  }

  // The refusal is per-connection, not a ban: the polling fallback holds
  // nothing open and must keep working throughout.
  const poll = await request.get("/api/stream?mode=poll");
  expect(poll.status()).toBe(200);
});

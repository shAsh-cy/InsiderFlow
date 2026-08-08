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
 *
 * The ceiling is READ from the environment rather than assumed, so a
 * deployment that tunes SSE_MAX_CONCURRENT_PER_IP still has its real ceiling
 * asserted instead of a number this file happened to be written against.
 *
 * It cannot be raised far, and that is a property of the BROWSER, not the
 * server: one origin gets six concurrent HTTP/1.1 connections, so a cap above
 * that would leave the surplus attempts queued behind streams that hold for
 * 25 seconds, and the test would time out having proved nothing.
 */

const CAP = Number(process.env.SSE_MAX_CONCURRENT_PER_IP ?? 4);

test("refuses excess concurrent streams with 503 and Retry-After", async ({ page, request }) => {
  await page.goto("/");

  const result = await page.evaluate(async (cap: number) => {
    const controllers: AbortController[] = [];
    try {
      // Comfortably above whatever the per-client ceiling actually is.
      const attempts = Array.from({ length: cap + 4 }, () => {
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
  }, CAP);

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

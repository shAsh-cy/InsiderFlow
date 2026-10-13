import { expect, test } from "@playwright/test";

/**
 * WHAT THE PUBLIC API IS ALLOWED TO SAY.
 *
 * Every endpoint below is unauthenticated and cacheable. Whatever appears
 * in one of these bodies is public forever — a CDN may hold it, a client
 * may log it, a scraper certainly has it. So the interesting question is
 * not "is the data correct" but "is anything in here that was never meant
 * to leave the database".
 *
 * The list is drawn from what the schema actually holds next to the data
 * being served: a `user_id` on any public row would be a subscriber
 * identifier attached to a trade; `dedup_key` and `occurrence_key` are
 * ingestion bookkeeping that tells a scraper exactly how to collide with
 * our pipeline; a cursor's internals are the SSE resume protocol and
 * belong only in the `cursor` field that is designed to carry them.
 *
 * `sourceUrl` and `accessionNo` are deliberately NOT forbidden. They are
 * the provenance link and the SEC's own public filing identifier — the
 * product shows both, and hiding them would make the data less checkable
 * rather than more private.
 */

const PUBLIC_ENDPOINTS = [
  "/api/trades?limit=25",
  "/api/leaderboard?limit=10",
  "/api/politicians?limit=25",
  "/api/heatmap",
  "/api/companies?q=ZZ&limit=5",
  "/api/stream?mode=poll",
  // Added in r20. The six above were the whole list, and the four below are
  // the endpoints that share `serializeTrade` and the query layer with them —
  // so a widened select would have been caught on `/api/trades` and missed
  // here only by luck. `/api/screener/*` in particular joins the analytics
  // tables, which the six above do not touch.
  "/api/screener/cluster-buys?limit=10",
  "/api/screener/unusual-flow?limit=10",
  "/api/companies/ZZNOVA",
  "/api/companies/ZZNOVA/sentiment",
  "/api/health",
];

/** Keys that must never appear anywhere in a public body, at any depth. */
const FORBIDDEN_KEYS = [
  "user_id",
  "userId",
  "dedup_key",
  "dedupKey",
  "occurrence_key",
  "occurrenceKey",
  "raw_xml",
  "rawXml",
  "rawDocument",
  "email",
  "destination",
  "link_token",
  "linkToken",
  "unsubscribe_token",
  "unsubscribeToken",
  "apiKey",
  "api_key",
];

/** Every key present anywhere in a JSON value, at any depth. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      allKeys(nested, into);
    }
  }
  return into;
}

test.describe("the public API envelope", () => {
  for (const endpoint of PUBLIC_ENDPOINTS) {
    test(`${endpoint} exposes no internal field`, async ({ request }) => {
      const response = await request.get(endpoint);
      expect(response.status(), `${endpoint} must answer`).toBe(200);
      const body: unknown = await response.json();

      const keys = allKeys(body);
      // Asserted as a set difference rather than key-by-key, so the failure
      // message names every offender at once instead of the first.
      const leaked = FORBIDDEN_KEYS.filter((key) => keys.has(key));
      expect(
        leaked,
        `${endpoint} exposes ${leaked.join(", ")} — these are subscriber identifiers or ingestion ` +
          "bookkeeping, and this response is public and cacheable forever.",
      ).toEqual([]);
    });
  }

  test("the list endpoints keep the documented {data, meta} envelope", async ({ request }) => {
    // `/api/politicians` carries a third key, `note`, and it is not drift:
    // it states that STOCK Act amounts are brackets rather than figures and
    // that a PTR may be filed weeks after the trade. That is one of this
    // project's honesty invariants travelling with the data instead of
    // living only in the docs, so it is allowed BY NAME — a fourth key
    // would still fail here.
    const ALLOWED_EXTRA: Record<string, string[]> = { "/api/politicians?limit=2": ["note"] };
    for (const endpoint of ["/api/trades?limit=2", "/api/politicians?limit=2"]) {
      const body = (await (await request.get(endpoint)).json()) as Record<string, unknown>;
      const expected = ["data", "meta", ...(ALLOWED_EXTRA[endpoint] ?? [])].sort();
      expect(Object.keys(body).sort(), `${endpoint} envelope`).toEqual(expected);
      const meta = body.meta as Record<string, unknown>;
      // Pagination is offset-based and public. If an internal cursor ever
      // appears here it is a protocol leak, not a feature.
      expect(Object.keys(meta)).toContain("limit");
      expect(Object.keys(meta)).not.toContain("sql");
      expect(Object.keys(meta)).not.toContain("query");
    }
  });

  test("a trade carries provenance but not the pipeline's bookkeeping", async ({ request }) => {
    const body = (await (await request.get("/api/trades?limit=25")).json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(
      body.data.length,
      "the seed must produce rows for this to mean anything",
    ).toBeGreaterThan(0);
    const row = body.data[0]!;

    // The provenance half — deliberately present, and asserted so that
    // "trim the response" never quietly removes what makes the data
    // checkable.
    expect(Object.keys(row)).toContain("source");
    expect(Object.keys(row)).toContain("createdAt");

    // The nested objects are where an over-wide select shows up first.
    const company = row.company as Record<string, unknown>;
    const insider = row.insider as Record<string, unknown>;
    expect(Object.keys(company).sort()).toEqual(["id", "name", "ticker"]);
    expect(Object.keys(insider).sort()).toEqual([
      "id",
      "isDirector",
      "isOfficer",
      "isTenPctOwner",
      "name",
      "title",
    ]);
  });

  test("an error body names no internal detail", async ({ request }) => {
    // A stack trace, a SQL fragment or a file path in an error is a map of
    // the server drawn for whoever sent a bad request.
    //
    // Four URLs, not one. The single `?limit=notanumber` case only ever
    // exercised the ZodError branch of `handleApi`; a 404, an unauthenticated
    // /api/me route and an unknown screener preset each take a different path
    // to a body, and the three of them were untested.
    const cases = [
      "/api/trades?limit=notanumber",
      "/api/companies/THIS-TICKER-DOES-NOT-EXIST",
      "/api/screener/not-a-preset",
      "/api/me/watchlist",
    ];
    for (const url of cases) {
      const response = await request.get(url);
      const text = await response.text();
      expect(response.status(), `${url} must answer with a status, not hang`).toBeLessThan(600);
      for (const marker of [
        "at Object.",
        "node_modules",
        "/app/",
        "SELECT ",
        "pg_",
        "ECONNREFUSED",
        "insiderflow_app",
        "pooler.supabase.com",
      ]) {
        expect(text, `${url} leaked ${marker}`).not.toContain(marker);
      }
    }
  });

  test("/api/health reports a cause without describing the deployment", async ({ request }) => {
    // The endpoint the docs tell you to point an uptime monitor at:
    // unauthenticated, uncached, `Access-Control-Allow-Origin: *`. Its 503
    // branch used to answer with postgres.js's message verbatim, which names
    // the application role, the pooler hostname, the region and the internal
    // address. It is a 200 here — the database is up — so what this asserts
    // is that the SHAPE cannot carry those even when it is not.
    const response = await request.get("/api/health");
    const text = await response.text();
    // 200, flatly. `globalSetup` has already proved the database is up, so
    // a 503 here is a real failure and accepting it would make this test
    // unable to fail — the 503 BODY is pinned by the classifier's unit test
    // in src/lib/api/error-redaction.ts, which can produce one on demand.
    expect(response.status(), "the database is up; a 503 is a genuine failure").toBe(200);
    // `password` on its own was the first version of this list and it FAILED
    // on a healthy response: the readiness block legitimately contains
    // "Email+password provider disabled", which is a deployment step this
    // project deliberately reports. A marker that matches correct output is a
    // marker that gets deleted the first week, so the list names what a
    // DRIVER leak actually looks like instead of a word that appears in it.
    for (const marker of [
      "insiderflow_app",
      "pooler.supabase.com",
      "ECONNREFUSED",
      "password authentication",
      "getaddrinfo",
      "postgres://",
    ]) {
      expect(text, `/api/health leaked ${marker}`).not.toContain(marker);
    }
  });

  test("the signed-out /api/me routes say only that a session is required", async ({ request }) => {
    // `/api/me/watchlist` and `/api/me/alert-rules` returned whole Drizzle
    // rows until r20, so every response carried `userId` — a key this file
    // has forbidden since it was written and only ever checked against the
    // public endpoints. Without credentials the suite cannot read an
    // authenticated body, so this asserts the reachable half: the 401 is a
    // fixed envelope, and the authenticated shape is pinned by the
    // schema-driven unit test in src/lib/api/me-serializers.test.ts.
    for (const url of ["/api/me/watchlist", "/api/me/alert-rules", "/api/me/channels"]) {
      const response = await request.get(url);
      expect(response.status(), `${url} must refuse an anonymous read`).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "unauthorized", message: "Sign in required" },
      });
    }
  });
});

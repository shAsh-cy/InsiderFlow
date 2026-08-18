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
    const response = await request.get("/api/trades?limit=notanumber");
    const text = await response.text();
    for (const marker of [
      "at Object.",
      "node_modules",
      "/app/",
      "SELECT ",
      "pg_",
      "ECONNREFUSED",
    ]) {
      expect(text, `an error body leaked ${marker}`).not.toContain(marker);
    }
  });
});

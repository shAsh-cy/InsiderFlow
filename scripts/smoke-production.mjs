#!/usr/bin/env node
/**
 * POST-DEPLOY SMOKE TESTS, against a URL that is already serving the public.
 *
 * This runs between the deploy and the flip of DEPLOYMENT_ACTIVE. Everything
 * it checks is something that has actually gone wrong on this project, or
 * something that only a real deployment can be wrong about:
 *
 *   - the security headers were recorded as "already in place" in r12 and a
 *     check of the running build found Content-Security-Policy and nothing
 *     else. They are asserted on a DOCUMENT and on a JSON API, because the
 *     middleware matcher excludes /api/*;
 *   - `X-Powered-By: Next.js` shipped on every response until r20, because
 *     `poweredByHeader` had never been set;
 *   - /api/me/* returned whole Drizzle rows including `user_id` until r20;
 *   - /api/health answered its 503 with postgres.js's message verbatim, which
 *     names the application role, the pooler host, the region and an internal
 *     address;
 *   - the honesty invariants — politician amounts are RANGES, superseded
 *     filings are hidden, an undisclosed value is never rendered as 0 — are
 *     the product's central claim, and production is the first place they meet
 *     real data.
 *
 * ── A SKIP IS A FAILURE ───────────────────────────────────────────────
 *
 * Every check prints PASS, FAIL, or SKIP with a reason, and a SKIP exits
 * non-zero exactly like a FAIL. An unchecked control is not a passing one, and
 * this script's whole job is to be the last thing between a build and the
 * public. The one exception is marked NOTE and is explained where it appears.
 *
 * Usage:
 *   node scripts/smoke-production.mjs --base=https://insiderflow.vercel.app
 *   node scripts/smoke-production.mjs --base=http://localhost:3100
 *
 * Options:
 *   --expect-password=yes|no   whether the login page may offer a password
 *                              field. Default `no`, which is the production
 *                              decision recorded in DEPLOY.md.
 */

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = (arg("base", process.env.SMOKE_BASE_URL ?? "http://localhost:3100") ?? "").replace(
  /\/$/,
  "",
);
const EXPECT_PASSWORD = arg("expect-password", "no") === "yes";

if (!BASE) {
  console.error("smoke: --base is required (or set SMOKE_BASE_URL)");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

const record = (verdict, name, detail) => {
  const line = detail ? `${name} — ${detail}` : name;
  console.log(`  [${verdict}] ${line}`);
  if (verdict === "PASS") passed += 1;
  else {
    failed += 1;
    failures.push(line);
  }
};

const pass = (name, detail) => record("PASS", name, detail);
const fail = (name, detail) => record("FAIL", name, detail);
/** Reported and counted as a failure: an unchecked control is not a passing one. */
const skip = (name, detail) => record("SKIP", name, detail);

const section = (title) => console.log(`\n=== ${title}`);

/** Fetch that never throws, so one dead endpoint cannot end the run. */
async function get(path, init) {
  const url = `${BASE}${path}`;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      ...init,
      headers: { "user-agent": "InsiderFlow-smoke/1.0", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    return { ok: true, status: response.status, headers: response.headers, text, url };
  } catch (error) {
    return {
      ok: false,
      status: -1,
      headers: new Headers(),
      text: "",
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const json = (result) => {
  try {
    return JSON.parse(result.text);
  } catch {
    return null;
  }
};

/** Every key present anywhere in a JSON value, at any depth. */
function allKeys(value, into = new Set()) {
  if (Array.isArray(value)) for (const item of value) allKeys(item, into);
  else if (value !== null && typeof value === "object")
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      allKeys(nested, into);
    }
  return into;
}

console.log(`InsiderFlow production smoke — ${BASE}`);

// ── 1. It is serving at all ────────────────────────────────────────────────
section("reachability and health");

const health = await get("/api/health");
if (!health.ok) {
  fail("/api/health is reachable", health.error);
} else if (health.status !== 200) {
  // 503 here is the database being unreachable, which is a deploy failure and
  // not a transient to retry past.
  fail("/api/health answers 200", `status ${health.status}, body ${health.text.slice(0, 200)}`);
} else {
  pass("/api/health answers 200");
  const body = json(health);
  if (!body) fail("/api/health returns JSON");
  else pass("/api/health returns JSON", `status "${body.status}"`);
}

// ── 2. The database connection actually works, as the app role ─────────────
//
// There is no header that says "this process connected via APP_DATABASE_URL".
// What there is: getDb() THROWS when the RLS gate's verdict is fatal, so every
// data route 500s. A 200 with rows therefore proves the connection was made
// and, combined with the pre-deploy assertion that Vercel's production
// environment declares DEPLOY_ENV and APP_DATABASE_URL, proves which one.
section("the app is connected to a database it is allowed to use");

const trades = await get("/api/trades?limit=50");
const tradesBody = json(trades);
if (trades.status !== 200 || !tradesBody) {
  fail(
    "/api/trades answers 200 with JSON",
    `status ${trades.status} — getDb() throws when APP_DATABASE_URL is missing in a production stance`,
  );
} else {
  pass("/api/trades answers 200 with JSON", `${tradesBody.data?.length ?? 0} rows`);
}

// ── 3. Security headers, on a document AND on a JSON API ───────────────────
section("security headers");

const EXPECTED = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-dns-prefetch-control": "off",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
};

const document = await get("/");
for (const [path, result] of [
  ["/", document],
  ["/api/health", health],
]) {
  if (result.status < 200) {
    fail(`headers on ${path}`, "unreachable");
    continue;
  }
  for (const [key, want] of Object.entries(EXPECTED)) {
    const got = result.headers.get(key);
    if (got === want) pass(`${key} on ${path}`);
    else fail(`${key} on ${path}`, `got ${got === null ? "<absent>" : `"${got}"`}`);
  }
  // r20: this was on every response until poweredByHeader was set.
  const powered = result.headers.get("x-powered-by");
  if (powered === null) pass(`no X-Powered-By on ${path}`);
  else fail(`no X-Powered-By on ${path}`, `got "${powered}"`);
}

// CSP carries a per-request nonce and is set in the middleware, whose matcher
// deliberately excludes /api/* — so it is asserted on the document only.
const csp = document.headers.get("content-security-policy");
if (!csp) fail("Content-Security-Policy on /");
else {
  if (/'nonce-[A-Za-z0-9+/=_-]{8,}'/.test(csp)) pass("CSP carries a per-request nonce");
  else fail("CSP carries a per-request nonce", csp.slice(0, 160));
  if (csp.includes("frame-ancestors 'none'")) pass("CSP frame-ancestors 'none'");
  else fail("CSP frame-ancestors 'none'", csp.slice(0, 160));
  if (!/(^|\s)http:/.test(csp)) pass("CSP names no http origin");
  else fail("CSP names no http origin", csp.slice(0, 160));
}

// Two documents, different nonces, or it is not per-request.
const document2 = await get("/");
const nonce = (value) => /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(value ?? "")?.[1] ?? null;
const [n1, n2] = [nonce(csp), nonce(document2.headers.get("content-security-policy"))];
if (n1 && n2 && n1 !== n2) pass("the nonce differs between two requests");
else if (n1 && n2) fail("the nonce differs between two requests", "the same nonce came back twice");
else skip("the nonce differs between two requests", "no nonce to compare");

// ── 4. Caching: the API may be shared-cached, the HTML must not be ─────────
section("cache-control");

const tradesCache = trades.headers.get("cache-control") ?? "";
if (/s-maxage=\d+/.test(tradesCache)) pass("/api/trades is edge-cacheable", tradesCache);
else fail("/api/trades is edge-cacheable", `got "${tradesCache}"`);

const htmlCache = document.headers.get("cache-control") ?? "";
// Locale and session both live in cookies, so shared-caching the HTML serves
// one visitor's signed-in page to the next.
if (/no-store/.test(htmlCache)) pass("the HTML is never shared-cached", htmlCache);
else fail("the HTML is never shared-cached", `got "${htmlCache}"`);

// ── 5. No source maps ──────────────────────────────────────────────────────
section("no source maps served");

const chunk = /\/_next\/static\/chunks\/[^"']+?\.js/.exec(document.text)?.[0];
if (!chunk) {
  skip("a chunk URL was found in the document", "cannot check for .map without one");
} else {
  const map = await get(`${chunk}.map`);
  if (map.status === 404) pass("chunk source map is not served", `${chunk}.map -> 404`);
  else fail("chunk source map is not served", `${chunk}.map -> ${map.status}`);
}

// ── 6. security.txt ────────────────────────────────────────────────────────
section("RFC 9116 security.txt");

const sec = await get("/.well-known/security.txt");
if (sec.status !== 200) {
  fail("security.txt is served", `status ${sec.status}`);
} else {
  pass("security.txt is served");
  const expires = /^Expires:\s*(.+)$/m.exec(sec.text)?.[1]?.trim();
  const when = expires ? Date.parse(expires) : NaN;
  if (Number.isNaN(when)) fail("security.txt declares a parseable Expires", expires ?? "<absent>");
  else if (when <= Date.now())
    // An expired security.txt is worse than none: it tells a finder the
    // contact is stale and not worth using.
    fail("security.txt has not expired", `Expires ${new Date(when).toISOString()}`);
  else pass("security.txt has not expired", `Expires ${new Date(when).toISOString()}`);
  if (/^Contact:/m.test(sec.text)) pass("security.txt names a contact");
  else fail("security.txt names a contact");
}

// ── 7. The signed-out contract on /api/me/* ────────────────────────────────
section("/api/me/* refuses anonymous reads and leaks nothing");

const FORBIDDEN = [
  "user_id",
  "userId",
  "dedup_key",
  "dedupKey",
  "link_token",
  "linkToken",
  "unsubscribe_token",
  "unsubscribeToken",
  "raw_xml_url",
  "rawXmlUrl",
];

for (const path of ["/api/me/watchlist", "/api/me/alert-rules", "/api/me/channels"]) {
  const result = await get(path);
  if (result.status !== 401) {
    fail(`${path} refuses an anonymous read`, `status ${result.status}`);
    continue;
  }
  const body = json(result);
  const keys = body ? allKeys(body) : new Set();
  const leaked = FORBIDDEN.filter((key) => keys.has(key));
  if (leaked.length === 0) pass(`${path} answers 401 and exposes no internal field`);
  else fail(`${path} answers 401 and exposes no internal field`, `leaked ${leaked.join(", ")}`);
}

// ── 8. No infrastructure detail anywhere in a body ─────────────────────────
section("no infrastructure detail in any body");

// The exact strings postgres.js used to hand back through /api/health's 503,
// plus the ones an unhandled error would carry.
const INFRA_MARKERS = [
  "insiderflow_app",
  "pooler.supabase.com",
  "ECONNREFUSED",
  "getaddrinfo",
  "password authentication",
  "postgres://",
  "postgresql://",
  "at Object.",
  "node_modules",
  "SELECT ",
  "pg_",
];

for (const [label, result] of [
  ["/api/health", health],
  ["/api/trades (bad input)", await get("/api/trades?limit=notanumber")],
  ["/api/companies/THIS-DOES-NOT-EXIST", await get("/api/companies/THIS-DOES-NOT-EXIST")],
]) {
  const hit = INFRA_MARKERS.filter((m) => result.text.includes(m));
  if (hit.length === 0) pass(`${label} names no infrastructure`);
  else fail(`${label} names no infrastructure`, `contains ${hit.join(", ")}`);
}

// ── 9. The sign-in surface matches the production decision ─────────────────
section("sign-in surface");

const login = await get("/login");
if (login.status !== 200) {
  fail("/login is served", `status ${login.status}`);
} else {
  const hasPasswordField =
    /<input[^>]+type=["']password["']/i.test(login.text) ||
    /<input[^>]+name=["'][^"']*password/i.test(login.text) ||
    /<input[^>]+autocomplete=["'][^"']*password/i.test(login.text);
  if (EXPECT_PASSWORD === hasPasswordField) {
    pass(
      "the login page matches the recorded provider decision",
      EXPECT_PASSWORD ? "a password field is expected and present" : "no password field",
    );
  } else {
    fail(
      "the login page matches the recorded provider decision",
      EXPECT_PASSWORD
        ? "expected a password field and found none"
        : "A PASSWORD FIELD IS PRESENT. Production is GitHub OAuth + magic link; " +
            "see DEPLOY.md 'Supabase production decisions'.",
    );
  }
}

// ── 10. Honesty invariants, against real data ──────────────────────────────
section("honesty invariants");

// Politician amounts are RANGES because the STOCK Act only discloses ranges.
// A single `amount` field would be a fabricated precision.
const politicians = await get("/api/politicians?limit=50");
const politiciansBody = json(politicians);
if (politicians.status !== 200 || !politiciansBody) {
  fail("/api/politicians answers 200 with JSON", `status ${politicians.status}`);
} else {
  const rows = politiciansBody.data ?? [];
  if (rows.length === 0) {
    // Expected today: the house/senate-stock-watcher buckets answer 403, so
    // the table is empty. The SHAPE claim is still checkable and still checked
    // by the unit suite; here there is nothing to check, and saying so beats
    // a green tick over an empty array.
    skip(
      "politician amounts are ranges",
      "no politician rows in production — the upstream S3 buckets answer 403 " +
        "(README, 'Known defects'). Structure is covered by the unit suite.",
    );
  } else {
    const bad = rows.filter(
      (r) => !("amountRange" in r) || !("amountMin" in r) || !("amountMax" in r),
    );
    const bare = rows.filter((r) => "amount" in r);
    if (bad.length === 0 && bare.length === 0)
      pass("politician amounts are ranges", `${rows.length} rows`);
    else
      fail(
        "politician amounts are ranges",
        `${bad.length} without a range, ${bare.length} with a bare 'amount'`,
      );
  }
}

// Superseded filings are hidden by default: an amended Form 4 replaces the
// original, and showing both double-counts the trade.
if (tradesBody?.data) {
  const superseded = tradesBody.data.filter((t) => t.filing?.superseded === true);
  if (superseded.length === 0)
    pass("superseded filings are hidden by default", `${tradesBody.data.length} rows checked`);
  else fail("superseded filings are hidden by default", `${superseded.length} superseded rows`);
} else {
  skip("superseded filings are hidden by default", "no trades payload to check");
}

/*
 * A value the filing did not disclose renders as a marker, never as 0.
 *
 * WHAT THIS CHECKS, AND WHAT IT DELIBERATELY LEAVES TO THE E2E SUITE.
 *
 * The first version of this check grepped the page for "Not disclosed in the
 * filing" and failed against a perfectly correct page. That string is
 * `NotDisclosed`'s DEFAULT label, and `trade-table.tsx` passes a specific one
 * at three of its four call sites ("No officer title on this filing", "No
 * price per share …", "No cached price context …"). The check was asserting
 * one of four possible outputs.
 *
 * So it matches the COMPONENT instead of one of its labels: the emitted markup
 * is an em dash inside a `cursor-help` span with an `sr-only` description,
 * which is the same for every label.
 *
 * It does NOT try to prove the absence of a rendered "$0" from raw HTML. The
 * page ships a React Flight payload in which `"$0:f:0:1:…"` is a module
 * reference, so a `$0` grep finds four hits on a page with no currency zero
 * anywhere — the same false-positive shape this project has now hit three
 * times. Cell-level assertions need a browser that can read the rendered
 * table, which is `e2e/seed-honesty.spec.ts` and `e2e/export.spec.ts`, both
 * required on every PR.
 */
if (tradesBody?.data) {
  const undisclosed = tradesBody.data.filter((t) => t.value === null);
  const feed = await get("/trades");
  const marker = /cursor-help[^>]*>—<span class="sr-only">/;
  if (feed.status !== 200) {
    fail("the /trades page renders", `status ${feed.status}`);
  } else if (undisclosed.length === 0) {
    // NOTE rather than SKIP, and it does not fail the run: there is genuinely
    // nothing to render, and blocking a deploy because production happens to
    // hold no undisclosed value would be a false red.
    console.log(
      "  [NOTE] undisclosed-value rendering not exercised — no null-value row in " +
        "the 50-row sample. Covered by e2e/seed-honesty.spec.ts.",
    );
  } else if (marker.test(feed.text)) {
    pass(
      "an undisclosed value renders as a marker, not a figure",
      `${undisclosed.length} null-value rows, marker present`,
    );
  } else {
    fail(
      "an undisclosed value renders as a marker, not a figure",
      `${undisclosed.length} null-value rows in the API and no NotDisclosed marker in the page`,
    );
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log("");
console.log(`SMOKE: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const line of failures) console.log(`  - ${line}`);
  console.log("\nDo NOT flip DEPLOYMENT_ACTIVE. Roll back.");
  process.exit(1);
}
console.log("All smoke checks passed.");

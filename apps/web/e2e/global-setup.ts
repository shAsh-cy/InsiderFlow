import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * FAIL FAST WHEN THE DATABASE IS NOT THERE.
 *
 * This exists because of two incidents, both of which cost real time and
 * both of which reported something other than what was wrong.
 *
 *   1. Postgres stopped mid-session (Docker Desktop had exited). Every
 *      page still returned 200 — after 13 to 38 seconds, because the
 *      connection pool was retrying against a dead socket and the pages
 *      rendered with empty data. Playwright reported it as tests exceeding
 *      their 30s budget, which reads as a performance regression in
 *      whatever was changed last. It was not. `/api/trades` was answering
 *      500 in 146ms and the server log said ECONNREFUSED.
 *
 *   2. The seed aged out of its own 24-hour window overnight, so "filings
 *      today" was legitimately 0 and the freshness spec failed as though
 *      the product had broken.
 *
 * A suite that degrades into timeouts when its dependencies are missing is
 * a suite that lies about which component failed. Both conditions are
 * cheap to detect up front and impossible to misread when they are named.
 *
 * Runs once, before any project. The check goes through the same
 * `docker exec` path `fixtures.ts` uses to write synthetic rows, so a
 * container that is up but unreachable from that path fails here rather
 * than inside the first fixture that needs it.
 */

const CONTAINER = "insiderflow-postgres";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "insiderflow", "-t", "-A", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function abort(what: string, detail: string, remedy: string): never {
  // Thrown, not `process.exit` — Playwright prints the message and marks
  // the run failed. An exit code alone produces "Error: process exited
  // with code 1", which is the class of message this file exists to stop.
  throw new Error(
    [
      "",
      `E2E PRE-FLIGHT FAILED — ${what}`,
      "",
      `  ${detail}`,
      "",
      `  Fix: ${remedy}`,
      "",
      "  Not a product failure. No tests were run.",
      "",
    ].join("\n"),
  );
}

/**
 * IS THE SERVER WE ARE ABOUT TO REUSE THE ONE WE MEANT TO TEST?
 *
 * `webServer.reuseExistingServer` is what makes an iterative local run
 * bearable, and it is also the third incident. A `next start` left over
 * from an earlier session held port 3100 and Playwright reused it in
 * silence, so 323 tests ran against a build that predated the branch by
 * two commits. It reported 120 failures in specs the branch never
 * touched — footer geometry, a treemap's ARIA role — which reads as a
 * catastrophic regression and was a stale process.
 *
 * The config's own comment says "a stale one would be a silent lie", and
 * guards only CI. This guards the case that actually happened.
 *
 * It fails in BOTH directions, which is the point: a stale server can
 * invent failures, as it did, and it can just as easily hide real ones by
 * serving code where the bug has not been written yet.
 */
async function assertServerMatchesBuild(port: number): Promise<void> {
  const listening = await fetch(`http://localhost:${port}/api/health`, {
    signal: AbortSignal.timeout(4000),
  })
    .then(() => true)
    .catch(() => false);

  // Nothing there: Playwright is about to build and start its own, which
  // is the case this check has no opinion about.
  if (!listening) return;

  let buildId: string;
  try {
    buildId = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    abort(
      "a server is already running, and there is no local build to compare it to",
      `something is listening on ${port} but .next/BUILD_ID does not exist, so this run ` +
        "would reuse a server whose provenance cannot be established.",
      `stop it (the suite will then build its own), or run \`pnpm --filter @insiderflow/web exec next build\` first.`,
    );
  }

  // Every build gets a fresh id, and its static assets are served under
  // it. A server built from a different tree 404s on this path.
  const response = await fetch(
    `http://localhost:${port}/_next/static/${buildId}/_buildManifest.js`,
    { signal: AbortSignal.timeout(4000) },
  ).catch(() => null);

  if (!response || !response.ok) {
    abort(
      "the server on this port is serving a DIFFERENT build",
      `.next/BUILD_ID is ${buildId}, and the running server does not serve that build's assets ` +
        `(${response ? `HTTP ${response.status}` : "request failed"}). Tests would run against ` +
        "code that is not the code in this working tree.",
      `stop the process holding port ${port} and re-run — Playwright will build and start its own. ` +
        "On Windows: `netstat -ano | findstr :" +
        port +
        "` then `taskkill /PID <pid> /F`.",
    );
  }

  // The build can also be older than the SOURCE, which the check above
  // cannot see: both server and .next agree, and both predate an edit.
  const newest = newestMtime(join(process.cwd(), "src"));
  const builtAt = statSync(join(process.cwd(), ".next", "BUILD_ID")).mtimeMs;
  if (newest > builtAt) {
    abort(
      "the running server is older than the source",
      `a file under src/ was modified ${Math.round((newest - builtAt) / 1000)}s after the build ` +
        "the reused server is serving. The edit under test is not in it.",
      `stop the process holding port ${port} and re-run.`,
    );
  }
}

/** Newest mtime under a directory, in ms. */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

export default async function globalSetup(): Promise<void> {
  // 1. Is the database reachable at all?
  let now: string;
  try {
    now = psql("select 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    abort(
      "the database is unreachable",
      `\`docker exec ${CONTAINER} psql\` failed: ${message.split("\n")[0]}`,
      "start Docker Desktop, then `docker compose up -d postgres`. " +
        "If the container is running, check it is named " +
        `${CONTAINER} and is healthy (\`docker ps\`).`,
    );
  }
  if (now !== "1") {
    abort(
      "the database answered, but not with what was asked",
      `select 1 returned ${JSON.stringify(now)}`,
      "check which database the container is serving.",
    );
  }

  // 2. Is there data, and is it inside the window the product's own
  //    freshness assertions read? A live but empty or stale database
  //    fails a dozen specs for reasons that have nothing to do with them.
  let total = 0;
  let recent = 0;
  try {
    total = Number(psql("select count(*) from transactions"));
    recent = Number(
      psql("select count(*) from transactions where created_at > now() - interval '24 hours'"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    abort(
      "the schema is not there",
      `counting transactions failed: ${message.split("\n")[0]}`,
      "`pnpm db:migrate && pnpm seed`.",
    );
  }

  if (total === 0) {
    abort("the database is empty", "transactions is empty", "`pnpm seed`.");
  }
  if (recent === 0) {
    abort(
      "the seed has aged out of its own window",
      `${total} transactions, but none ingested in the last 24 hours — ` +
        "the freshness specs assert a non-zero 'filings today' and will fail on data, not on code.",
      "`pnpm seed` (re-stamps arrivals across yesterday and today).",
    );
  }

  // 3. If a server is already up, is it OUR server? Only meaningful for
  //    the managed port: PLAYWRIGHT_BASE_URL means the operator chose the
  //    target deliberately and this check has no standing to second-guess
  //    which build is running there.
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    await assertServerMatchesBuild(3100);
  }

  // stderr, NOT stdout. The JSON and JUnit reporters write their document
  // to stdout, and anything else printed there lands inside it — this line
  // on stdout turned `--reporter=json` into "Unexpected token 'e'" and
  // would have broken any CI step that parses the run.
  process.stderr.write(`e2e pre-flight ok — ${total} transactions, ${recent} within 24h\n`);
}

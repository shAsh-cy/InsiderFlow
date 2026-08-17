import { execFileSync } from "node:child_process";

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

export default function globalSetup(): void {
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

  // stderr, NOT stdout. The JSON and JUnit reporters write their document
  // to stdout, and anything else printed there lands inside it — this line
  // on stdout turned `--reporter=json` into "Unexpected token 'e'" and
  // would have broken any CI step that parses the run.
  process.stderr.write(`e2e pre-flight ok — ${total} transactions, ${recent} within 24h\n`);
}

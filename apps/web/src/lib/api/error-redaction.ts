/**
 * WHAT A FAILING REQUEST IS ALLOWED TO SAY.
 *
 * `handleApi` already gets this right for every endpoint it wraps: the
 * catch-all logs `console.error("api_error", error)` and answers
 * `{"error":{"code":"internal","message":"Internal server error"}}`. The
 * diagnosis goes to the operator's log; the caller gets a status code.
 *
 * `/api/health` did not, and it is the one endpoint that is unauthenticated,
 * uncached, `Access-Control-Allow-Origin: *`, and documented as the thing to
 * point an uptime monitor at. It answered a 503 with
 *
 *     error: error instanceof Error ? error.message : "database unreachable"
 *
 * which is postgres.js's message, verbatim. That message names things:
 *
 *     password authentication failed for user "insiderflow_app"
 *     getaddrinfo ENOTFOUND aws-0-ap-south-1.pooler.supabase.com
 *     connect ECONNREFUSED 10.0.3.17:6543
 *
 * — the application role, the database host, the region, the internal
 * address. None of that is needed to answer "is the site up", and all of it
 * is free reconnaissance during the exact window when something is already
 * wrong.
 *
 * The fix is not a regex over the message. Scrubbing what you thought of
 * leaves what you did not, and driver messages change between versions. The
 * classifier below never reads the message at all: it maps an error to one of
 * a closed set of causes using structured fields, and returns a member of
 * that set. There is no path from input text to output text.
 */

/** The complete set of things a failure may say. Nothing else is emitted. */
export const HEALTH_FAILURES = [
  "database_unreachable",
  "database_auth_failed",
  "database_timeout",
  "database_error",
] as const;

export type HealthFailure = (typeof HEALTH_FAILURES)[number];

/** Node/libuv connection errors, by `code`. */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
]);

const TIMEOUT_CODES = new Set(["ETIMEDOUT", "CONNECT_TIMEOUT", "57014"]);

/**
 * SQLSTATE class 28 is invalid authorization; 3D000/3F000 are unknown
 * database/schema. Both are configuration, and both are reported as the same
 * "we could reach it and it said no" without repeating which credential.
 */
const AUTH_SQLSTATE = /^(28|3D|3F)/;

function codeOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * Map any thrown value to one of `HEALTH_FAILURES`.
 *
 * Never returns anything derived from the error's text. The return value is
 * always one of four compile-time constants.
 */
export function classifyHealthError(error: unknown): HealthFailure {
  const code = codeOf(error);
  if (AUTH_SQLSTATE.test(code)) return "database_auth_failed";
  if (TIMEOUT_CODES.has(code)) return "database_timeout";
  if (UNREACHABLE_CODES.has(code)) return "database_unreachable";
  // No structured code: a bare `new Error(...)`, or a driver version that
  // stopped setting one. Fall back to the least specific member rather than
  // to the message.
  return "database_error";
}

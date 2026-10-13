import { ZodError, z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { ApiError, handleApi } from "./http";
import { HEALTH_FAILURES, classifyHealthError } from "./error-redaction";

/**
 * A FAILING REQUEST MUST NOT DESCRIBE THE SERVER.
 *
 * Two surfaces, and they failed differently.
 *
 * `handleApi` was already right: its catch-all logs the error and answers a
 * fixed `{"error":{"code":"internal","message":"Internal server error"}}`.
 * That behaviour had no test, so "already right" was a reading of the code
 * rather than a property of it.
 *
 * `/api/health` was wrong, and it is the worst endpoint to be wrong on:
 * unauthenticated, uncached, `Access-Control-Allow-Origin: *`, and the one
 * the docs tell you to point an uptime monitor at. It answered a 503 with
 * postgres.js's message verbatim — which names the application role, the
 * pooler hostname, the region and the internal address.
 *
 * The tests below use error messages stuffed with exactly those things, and
 * assert on the OUTPUT rather than on the classification, because the claim
 * worth checking is "no substring of the input reached the caller" and not
 * "the branch I expected ran".
 */

/** Everything a real driver error has said, in the incidents that motivated this. */
const LOUD_ERRORS: Array<{ what: string; error: unknown; secrets: string[] }> = [
  {
    what: "password authentication failure naming the role",
    error: Object.assign(new Error('password authentication failed for user "insiderflow_app"'), {
      code: "28P01",
    }),
    secrets: ["insiderflow_app", "password authentication"],
  },
  {
    what: "DNS failure naming the pooler host and region",
    error: Object.assign(new Error("getaddrinfo ENOTFOUND aws-0-ap-south-1.pooler.supabase.com"), {
      code: "ENOTFOUND",
    }),
    secrets: ["pooler.supabase.com", "ap-south-1", "getaddrinfo"],
  },
  {
    what: "refused connection naming an internal address",
    error: Object.assign(new Error("connect ECONNREFUSED 10.0.3.17:6543"), {
      code: "ECONNREFUSED",
    }),
    secrets: ["10.0.3.17", "6543"],
  },
  {
    what: "a query error carrying SQL",
    error: Object.assign(
      new Error('relation "alert_channels" does not exist\n  SELECT * FROM alert_channels'),
      { code: "42P01" },
    ),
    secrets: ["SELECT", "alert_channels", "relation"],
  },
  {
    what: "a plain Error with no structured code",
    error: new Error("something at /app/apps/web/.next/server/chunks/1234.js:56:78"),
    secrets: ["/app/", ".next", "chunks"],
  },
  { what: "a thrown string", error: "postgres://user:hunter2@host/db", secrets: ["hunter2"] },
  { what: "a thrown null", error: null, secrets: [] },
];

describe("classifyHealthError", () => {
  it.each(LOUD_ERRORS)("$what → a closed-set value carrying none of it", ({ error, secrets }) => {
    const result = classifyHealthError(error);
    expect(HEALTH_FAILURES as readonly string[]).toContain(result);
    for (const secret of secrets) {
      expect(result, `the classification echoed ${secret}`).not.toContain(secret);
    }
  });

  it("answers with a member of the closed set for absolutely anything", () => {
    for (const value of [undefined, 0, [], {}, Symbol("x"), () => {}, new Date()]) {
      expect(HEALTH_FAILURES as readonly string[]).toContain(classifyHealthError(value));
    }
  });

  it("distinguishes the causes an operator actually acts on", () => {
    // Not decoration: "the credential is wrong" and "the host is gone" lead
    // to different actions, and collapsing them into one string would make
    // the endpoint useless rather than merely quiet.
    expect(classifyHealthError({ code: "28P01" })).toBe("database_auth_failed");
    expect(classifyHealthError({ code: "ENOTFOUND" })).toBe("database_unreachable");
    expect(classifyHealthError({ code: "ETIMEDOUT" })).toBe("database_timeout");
    expect(classifyHealthError({ code: "42P01" })).toBe("database_error");
  });
});

/** The markers e2e/api-envelope.spec.ts hunts for, checked here in-process too. */
const SERVER_MARKERS = ["at Object.", "node_modules", "/app/", "SELECT ", "pg_", "ECONNREFUSED"];

describe("handleApi keeps the server's internals out of the response", () => {
  const request = () => new Request("https://insiderflow.test/api/trades?limit=1");

  it("answers a thrown driver error with a fixed envelope and logs the detail instead", async () => {
    const error = new Error(
      'password authentication failed for user "insiderflow_app"\n' +
        "    at Object.connect (/app/node_modules/postgres/cf/src/connection.js:1:1)\n" +
        "    SELECT count(*) FROM pg_stat_activity",
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleApi(request(), null, () => Promise.reject(error));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal", message: "Internal server error" },
    });
    for (const marker of SERVER_MARKERS) {
      expect(text, `the 500 body leaked ${marker}`).not.toContain(marker);
    }
    expect(text).not.toContain("insiderflow_app");
    // Withheld from the caller, not from the operator.
    expect(consoleError).toHaveBeenCalledWith("api_error", error);
    consoleError.mockRestore();
  });

  it("answers a Zod failure with the field problems and nothing else", async () => {
    const schema = z.object({ limit: z.coerce.number().int().max(100) });
    const response = await handleApi(request(), null, () =>
      Promise.reject(schema.safeParse({ limit: "notanumber" }).error ?? new ZodError([])),
    );
    const text = await response.text();
    expect(response.status).toBe(400);
    const body = JSON.parse(text) as { error: { issues: Array<{ path: string }> } };
    expect(body.error.issues.map((i) => i.path)).toEqual(["limit"]);
    for (const marker of SERVER_MARKERS) {
      expect(text, `the 400 body leaked ${marker}`).not.toContain(marker);
    }
  });

  it("passes an ApiError's own message through, because that one is written for the caller", async () => {
    const response = await handleApi(request(), null, () =>
      Promise.reject(new ApiError(404, "No company with that ticker")),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "No company with that ticker" },
    });
  });

  it("never lets a stack reach the body even when the thrown value is a bare object", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleApi(request(), null, () =>
      Promise.reject({ stack: "at Object.<anonymous> (/app/secret.js:1:1)", query: "SELECT 1" }),
    );
    const text = await response.text();
    expect(text).not.toContain("stack");
    expect(text).not.toContain("SELECT");
    consoleError.mockRestore();
  });
});

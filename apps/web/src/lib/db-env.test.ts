import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertDbEnvOrExit, connectionRole, deploymentStance, resolveDbEnv } from "./db-env";
import type { GateIo } from "./db-env";

/**
 * THE FALLBACK THAT WAS FOUND IN A REAL BUILD LOG.
 *
 * A local production build printed
 *
 *   {"event":"db_admin_fallback","detail":"APP_DATABASE_URL is not set ..."}
 *
 * and carried on. That line means the web app connects as the role migrations
 * use, which on every platform this targets has BYPASSRLS — so the FORCE ROW
 * LEVEL SECURITY policies on `user_watchlists`, `alert_rules`,
 * `alert_channels` and `alerts_log` apply to nobody, and one reader's
 * watchlist is one missing WHERE clause away from every reader.
 *
 * What makes it worth a hard failure rather than a louder warning is that it
 * is UNOBSERVABLE. The app filters by user id in its own SQL, so with the
 * policies inert every page renders exactly the same, every test passes and
 * every log stays quiet. Nothing downstream can notice.
 *
 * These tests drive the decision function directly, in both directions,
 * because "it fails in production" and "it still works in development" are two
 * claims and a check that only ever gets exercised one way is a check whose
 * other branch is a guess.
 */

const APP_URL = "postgres://insiderflow_app:s3cret@db.example.com:5432/insiderflow";
const ADMIN_URL = "postgres://postgres:s3cret@db.example.com:5432/insiderflow";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(webRoot, "../..");

describe("which environments count as production", () => {
  it("treats NODE_ENV=production as production when nothing has been declared", () => {
    expect(deploymentStance({ NODE_ENV: "production" })).toEqual({
      stance: "production",
      stanceFrom: "NODE_ENV",
    });
  });

  it("lets an explicit DEPLOY_ENV override NODE_ENV, in both directions", () => {
    // `next build` sets NODE_ENV=production for any production BUILD. The
    // Docker image, the e2e harness and the CI build step are production
    // builds and not deployments, and each says so at its own build site.
    expect(deploymentStance({ NODE_ENV: "production", DEPLOY_ENV: "e2e" }).stance).toBe(
      "non-production",
    );
    // …and the reverse: a VPS operator who means it opts back in with one
    // variable, without touching any code.
    expect(deploymentStance({ NODE_ENV: "development", DEPLOY_ENV: "production" }).stance).toBe(
      "production",
    );
  });

  it("lets the platform's VERCEL_ENV outrank a stale DEPLOY_ENV", () => {
    const verdict = deploymentStance({ VERCEL_ENV: "production", DEPLOY_ENV: "ci" });
    expect(verdict).toEqual({ stance: "production", stanceFrom: "VERCEL_ENV" });
  });

  it("is non-production when nothing at all is set", () => {
    expect(deploymentStance({}).stance).toBe("non-production");
  });

  it("reads an empty string as unset rather than as a value", () => {
    // Vercel, CI and docker-compose all render an unconfigured variable as ""
    // rather than omitting it. `env.DEPLOY_ENV ?? ...` would take "" as a
    // declaration and quietly demote a real production deployment.
    expect(deploymentStance({ NODE_ENV: "production", DEPLOY_ENV: "" })).toEqual({
      stance: "production",
      stanceFrom: "NODE_ENV",
    });
  });
});

describe("production refuses to run without an application role", () => {
  it("is FATAL and yields no connection when APP_DATABASE_URL is missing", () => {
    const verdict = resolveDbEnv({ NODE_ENV: "production", DATABASE_URL: ADMIN_URL });
    expect(verdict.level).toBe("fatal");
    expect(verdict.event).toBe("db_admin_fallback");
    // The important half: there is no degraded connection to fall back to.
    // A verdict that said "fatal" and still handed back the admin URL would
    // be one caller's `if` away from serving traffic unprotected.
    expect(verdict.url).toBeNull();
    expect(verdict.detail).toContain("row-level security");
    expect(verdict.detail).toContain("pnpm db:app-role");
  });

  it("is FATAL when APP_DATABASE_URL is the admin URL under a second name", () => {
    // The fallback, re-created by someone who set the variable the error
    // message named. Catalog flags and every log line look correct.
    const verdict = resolveDbEnv({
      NODE_ENV: "production",
      DATABASE_URL: ADMIN_URL,
      APP_DATABASE_URL: ADMIN_URL,
    });
    expect(verdict.level).toBe("fatal");
    expect(verdict.event).toBe("db_app_url_is_admin_url");
    expect(verdict.url).toBeNull();
  });

  it("is FATAL when the application role is one that bypasses RLS by name", () => {
    for (const role of ["postgres", "supabase_admin", "rds_superuser", "POSTGRES"]) {
      const verdict = resolveDbEnv({
        DEPLOY_ENV: "production",
        DATABASE_URL: "postgres://someone:pw@other.example.com:5432/db",
        APP_DATABASE_URL: `postgres://${role}:pw@db.example.com:5432/insiderflow`,
      });
      expect(verdict.level, role).toBe("fatal");
      expect(verdict.event, role).toBe("db_app_role_bypasses_rls");
    }
  });

  it("is FATAL everywhere, production or not, when there is no database URL at all", () => {
    for (const stance of [{ NODE_ENV: "production" }, { NODE_ENV: "development" }]) {
      const verdict = resolveDbEnv(stance);
      expect(verdict.level).toBe("fatal");
      // Its own event, so a missing database never reads as an RLS finding.
      expect(verdict.event).toBe("db_url_missing");
    }
  });

  it("passes when a distinct application role is configured", () => {
    const verdict = resolveDbEnv({
      NODE_ENV: "production",
      DATABASE_URL: ADMIN_URL,
      APP_DATABASE_URL: APP_URL,
    });
    expect(verdict.level).toBe("ok");
    expect(verdict.event).toBe("db_app_role_ok");
    expect(verdict.url).toBe(APP_URL);
    expect(verdict.detail).toContain("insiderflow_app");
  });
});

describe("development still works, and still says so", () => {
  it("WARNS rather than failing, and hands back the admin URL", () => {
    const verdict = resolveDbEnv({ NODE_ENV: "development", DATABASE_URL: ADMIN_URL });
    expect(verdict.level).toBe("warn");
    expect(verdict.event).toBe("db_admin_fallback");
    // A self-hoster who has not created the role yet gets a working site.
    // That is the whole reason this is not fatal everywhere.
    expect(verdict.url).toBe(ADMIN_URL);
  });

  it("warns rather than failing for the inert-configuration cases too", () => {
    expect(resolveDbEnv({ DATABASE_URL: ADMIN_URL, APP_DATABASE_URL: ADMIN_URL }).level).toBe(
      "warn",
    );
    expect(resolveDbEnv({ DATABASE_URL: ADMIN_URL, APP_DATABASE_URL: ADMIN_URL }).url).toBe(
      ADMIN_URL,
    );
  });
});

describe("connectionRole", () => {
  it("reads the username, url-decoded, and survives a string that is not a URL", () => {
    expect(connectionRole(APP_URL)).toBe("insiderflow_app");
    expect(connectionRole("postgres://app%5Fuser:pw@h/db")).toBe("app_user");
    expect(connectionRole("postgres://h/db")).toBeNull();
    expect(connectionRole("not a url")).toBeNull();
  });
});

describe("the build-time gate", () => {
  const spy = (): GateIo & { errors: string[]; warns: string[]; exits: number[] } => {
    const errors: string[] = [];
    const warns: string[] = [];
    const exits: number[] = [];
    return {
      errors,
      warns,
      exits,
      error: (m) => errors.push(m),
      warn: (m) => warns.push(m),
      exit: (c) => exits.push(c),
    };
  };

  it("exits non-zero on a production build with no APP_DATABASE_URL", () => {
    const io = spy();
    assertDbEnvOrExit({ NODE_ENV: "production", DATABASE_URL: ADMIN_URL }, io);
    expect(io.exits).toEqual([1]);
    expect(io.errors.join("\n")).toContain("BUILD REFUSED");
    // The message has to name the way out, or the next person finds one.
    expect(io.errors.join("\n")).toContain("DEPLOY_ENV");
  });

  it("does not exit on a development build, and prints the warning once", () => {
    const io = spy();
    assertDbEnvOrExit({ NODE_ENV: "development", DATABASE_URL: ADMIN_URL }, io);
    expect(io.exits).toEqual([]);
    expect(io.warns).toHaveLength(1);
    expect(JSON.parse(io.warns[0]!).event).toBe("db_admin_fallback");
  });

  it("does not exit, and says nothing, when the role is configured", () => {
    const io = spy();
    assertDbEnvOrExit({ NODE_ENV: "production", APP_DATABASE_URL: APP_URL }, io);
    expect(io.exits).toEqual([]);
    expect(io.warns).toEqual([]);
    expect(io.errors).toEqual([]);
  });

  it("is actually wired into next.config.ts", () => {
    // A gate nobody calls is the failure mode this whole file exists to
    // prevent, one level up.
    const config = readFileSync(join(webRoot, "next.config.ts"), "utf8");
    expect(config).toContain("assertDbEnvOrExit");
    expect(config).toMatch(/assertDbEnvOrExit\(process\.env/);
  });
});

describe("the three build sites that are not deployments declare themselves", () => {
  /**
   * Each of these runs `next build`, which sets NODE_ENV=production. Without
   * the declaration the build fails — loudly, so nobody could miss it. What
   * this asserts is the other direction: that none of them has been "fixed"
   * by claiming to be production and handing the gate a placeholder
   * connection string, which would leave every future run green and prove
   * nothing about any deployment.
   */
  const sites: Array<[string, string]> = [
    ["Dockerfile", join(repoRoot, "Dockerfile")],
    ["playwright.config.ts", join(webRoot, "playwright.config.ts")],
    ["ci.yml", join(repoRoot, ".github/workflows/ci.yml")],
  ];

  for (const [name, path] of sites) {
    it(`${name} declares a non-production DEPLOY_ENV and sets no APP_DATABASE_URL`, () => {
      const text = readFileSync(path, "utf8");
      // Comment lines are dropped first. All three files EXPLAIN the gate
      // above the line that satisfies it, and the Dockerfile's explanation
      // names `DEPLOY_ENV=production` as the way a VPS operator opts back in.
      // Matching prose would make this test fail on its own documentation.
      const code = text
        .split(/\r?\n/)
        .filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line))
        .join("\n");
      const declared = [...code.matchAll(/DEPLOY_ENV["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/g)].map(
        (m) => m[1],
      );
      expect(declared.length, `${name} must declare DEPLOY_ENV`).toBeGreaterThan(0);
      for (const value of declared) expect(value).not.toBe("production");
      expect(/APP_DATABASE_URL\s*[:=]\s*["']?postgres/i.test(code)).toBe(false);
    });
  }
});

describe("getDb", () => {
  const original = { ...process.env };
  const store = globalThis as unknown as {
    __insiderflowDb?: unknown;
    __insiderflowDbWarned?: boolean;
  };

  beforeEach(() => {
    vi.resetModules();
    delete store.__insiderflowDb;
    delete store.__insiderflowDbWarned;
    for (const key of [
      "APP_DATABASE_URL",
      "DATABASE_URL",
      "NODE_ENV",
      "DEPLOY_ENV",
      "VERCEL_ENV",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete store.__insiderflowDb;
    delete store.__insiderflowDbWarned;
    for (const [key, value] of Object.entries(original)) process.env[key] = value;
  });

  it("throws instead of serving a request over an unprotected connection", async () => {
    process.env.DEPLOY_ENV = "production";
    process.env.DATABASE_URL = ADMIN_URL;
    vi.doMock("@insiderflow/db", () => ({
      createDbHandle: () => {
        throw new Error("createDbHandle must not be reached on the fatal path");
      },
    }));
    const { getDb } = await import("./db");
    expect(() => getDb()).toThrow(/db_admin_fallback/);
  });

  it("connects and warns exactly once below production", async () => {
    process.env.DEPLOY_ENV = "development";
    process.env.DATABASE_URL = ADMIN_URL;
    const handles: string[] = [];
    vi.doMock("@insiderflow/db", () => ({
      createDbHandle: (url: string) => {
        handles.push(url);
        return { db: { marker: "db" }, end: async () => {} };
      },
    }));
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });

    const { getDb } = await import("./db");
    getDb();
    getDb();

    expect(handles).toEqual([ADMIN_URL]);
    // Once. A warning on every request is a warning nobody reads.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]![0] as string).event).toBe("db_admin_fallback");
  });

  it("connects with the application role and says nothing when configured", async () => {
    process.env.DEPLOY_ENV = "production";
    process.env.DATABASE_URL = ADMIN_URL;
    process.env.APP_DATABASE_URL = APP_URL;
    const handles: string[] = [];
    vi.doMock("@insiderflow/db", () => ({
      createDbHandle: (url: string) => {
        handles.push(url);
        return { db: { marker: "db" }, end: async () => {} };
      },
    }));
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });

    const { getDb } = await import("./db");
    getDb();

    expect(handles).toEqual([APP_URL]);
    expect(warn).not.toHaveBeenCalled();
  });
});

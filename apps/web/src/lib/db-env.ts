import { z } from "zod";

/**
 * WHICH DATABASE URL THE WEB APP IS ALLOWED TO USE, AND WHEN THAT IS FATAL.
 *
 * The user tables — `user_watchlists`, `alert_rules`, `alert_channels`,
 * `alerts_log` — carry FORCE ROW LEVEL SECURITY keyed on
 * `current_setting('app.user_id')`. Those policies are the ONLY thing standing
 * between one signed-in reader and every other reader's watchlist. They apply
 * to the connecting role, and a role with SUPERUSER or BYPASSRLS is exempt
 * from all of them.
 *
 * So `APP_DATABASE_URL` is not a tuning knob. It is the control. Without it
 * the app connects as the admin role that migrations use, every policy is
 * skipped, and every query returns every user's rows. The application code
 * still filters by user id in its WHERE clauses, so nothing looks broken —
 * which is precisely the problem. A missing defence that changes no observable
 * behaviour is one nobody notices until it is being exploited.
 *
 * ── WHY THIS IS A MODULE AND NOT AN `if` IN `db.ts` ───────────────────
 *
 * The same decision has to be made in two places that share no runtime:
 * `getDb()` when the first query is issued, and `next.config.ts` when the
 * build starts. Two copies of a security predicate drift, and the half that
 * drifts is always the half nobody reads. One pure function, two callers, and
 * a test that drives the function directly across the whole matrix.
 *
 * ── WHAT COUNTS AS "PRODUCTION" ───────────────────────────────────────
 *
 * `next build` sets `NODE_ENV=production` for ANY production build — the
 * Docker image, the e2e harness, a developer checking bundle size. None of
 * those is a deployment, and hard-failing them would mean the first thing
 * anyone did was find the switch that turns this off.
 *
 * The rule is therefore: an EXPLICIT declaration wins, and `NODE_ENV` decides
 * only when nothing has been declared.
 *
 *   VERCEL_ENV / DEPLOY_ENV set  → authoritative. "production" enforces.
 *   neither set                  → NODE_ENV === "production" enforces.
 *
 * That fails CLOSED: an undeclared production build is fatal, so the default
 * for a deployment nobody configured is refusal rather than a silent admin
 * connection. The three build sites that are legitimately not deployments —
 * the Dockerfile's web stage, the Playwright managed server, the CI build
 * step — each say so with `DEPLOY_ENV`, in the open, at the site. An
 * exemption written where the build happens can be reviewed; one written
 * here as `if (isDocker)` cannot.
 *
 * ── WHAT THIS CAN AND CANNOT PROVE ────────────────────────────────────
 *
 * This reads environment variables. It can prove that a distinct application
 * connection string was configured, and it can catch the two ways one is
 * configured and still inert (see below). It CANNOT prove the role at the far
 * end lacks BYPASSRLS, because that needs a connection and a catalog read.
 *
 * `pnpm db:bootstrap -- --check` is the half that proves enforcement: it
 * inserts a probe row as admin and tries to read it back over
 * `APP_DATABASE_URL` with no `app.user_id` set. Anything but zero rows is
 * `rls_not_enforced`. Neither half substitutes for the other, and
 * PRODUCTION_READINESS.md lists them as two claims rather than one.
 */

/** `production` means "this process is serving, or building for, a real deployment". */
export type DeploymentStance = "production" | "non-production";

export type DbEnvLevel = "ok" | "warn" | "fatal";

export interface DbEnvVerdict {
  level: DbEnvLevel;
  stance: DeploymentStance;
  /** Which variable decided the stance — quoted back so a surprising verdict is diagnosable. */
  stanceFrom: "VERCEL_ENV" | "DEPLOY_ENV" | "NODE_ENV" | "default";
  /** Stable, greppable. Log scrapers and docs key on these. */
  event:
    | "db_app_role_ok"
    | "db_admin_fallback"
    | "db_app_url_is_admin_url"
    | "db_app_role_bypasses_rls"
    | "db_url_missing";
  detail: string;
  /** The connection string the app should use, or null when it must refuse to start. */
  url: string | null;
}

/**
 * An empty string is not a value.
 *
 * CI, Vercel and docker-compose all set an unconfigured variable to `""`
 * rather than leaving it out, and `process.env.APP_DATABASE_URL || fallback`
 * treats those two identically while `zod`'s `.optional()` does not. Normalise
 * before parsing so "set to nothing" and "not set" reach one code path.
 */
const presence = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const DbEnvSchema = z.object({
  APP_DATABASE_URL: presence,
  DATABASE_URL: presence,
  NODE_ENV: presence,
  DEPLOY_ENV: presence,
  VERCEL_ENV: presence,
});

export type DbEnvInput = Record<string, string | undefined>;

/**
 * Roles that ship with BYPASSRLS or SUPERUSER on the platforms this project
 * targets. Naming one as the application role is the fallback bug wearing a
 * different variable name, and it is worth catching by name here because the
 * connection-time proof only runs when someone runs it.
 *
 * A false positive is impossible in the direction that matters: these names
 * are already taken on their platforms, so a NOBYPASSRLS role cannot be
 * created under any of them.
 */
const BYPASS_ROLE_NAMES = new Set([
  "postgres",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "rds_superuser",
  "rdsadmin",
  "root",
]);

/** The username in a connection string, or null when there isn't a parseable one. */
export function connectionRole(url: string): string | null {
  try {
    const username = new URL(url).username;
    return username ? decodeURIComponent(username) : null;
  } catch {
    return null;
  }
}

export function deploymentStance(env: DbEnvInput): {
  stance: DeploymentStance;
  stanceFrom: DbEnvVerdict["stanceFrom"];
} {
  const parsed = DbEnvSchema.parse(env);
  // Explicit beats inferred, and VERCEL_ENV beats DEPLOY_ENV because the
  // platform sets it and a stale DEPLOY_ENV in a project setting must not be
  // able to talk a real production deployment out of the check.
  if (parsed.VERCEL_ENV) {
    return {
      stance: parsed.VERCEL_ENV === "production" ? "production" : "non-production",
      stanceFrom: "VERCEL_ENV",
    };
  }
  if (parsed.DEPLOY_ENV) {
    return {
      stance: parsed.DEPLOY_ENV === "production" ? "production" : "non-production",
      stanceFrom: "DEPLOY_ENV",
    };
  }
  if (parsed.NODE_ENV) {
    return {
      stance: parsed.NODE_ENV === "production" ? "production" : "non-production",
      stanceFrom: "NODE_ENV",
    };
  }
  return { stance: "non-production", stanceFrom: "default" };
}

const REMEDY =
  "Create the role with `pnpm db:app-role` (needs APP_DB_PASSWORD), set APP_DATABASE_URL to " +
  "the connection string it prints, and prove enforcement with `pnpm db:bootstrap -- --check`. " +
  "See docs/auth.md.";

/**
 * The whole decision, from environment to verdict. Pure: no I/O, no globals.
 */
export function resolveDbEnv(env: DbEnvInput): DbEnvVerdict {
  const parsed = DbEnvSchema.parse(env);
  const { stance, stanceFrom } = deploymentStance(env);
  const fatalIfProduction: DbEnvLevel = stance === "production" ? "fatal" : "warn";
  const base = { stance, stanceFrom } as const;

  const appUrl = parsed.APP_DATABASE_URL;
  const adminUrl = parsed.DATABASE_URL;

  // Nothing at all: fatal everywhere, because there is no degraded mode to
  // fall back to. Kept as its own event so it never reads as an RLS finding.
  if (!appUrl && !adminUrl) {
    return {
      ...base,
      level: "fatal",
      event: "db_url_missing",
      detail: "Neither APP_DATABASE_URL nor DATABASE_URL is set.",
      url: null,
    };
  }

  if (!appUrl) {
    return {
      ...base,
      level: fatalIfProduction,
      event: "db_admin_fallback",
      detail:
        "APP_DATABASE_URL is not set, so the web app would use the admin DATABASE_URL. " +
        "That role bypasses row-level security, so every user's watchlists, alert rules, " +
        "alert channels and alert history would be readable by every request. " +
        REMEDY,
      // In production the caller must refuse; below production the fallback is
      // still what a self-hoster gets, announced rather than silent.
      url: stance === "production" ? null : (adminUrl ?? null),
    };
  }

  // Configured, and inert. Both of these are how the fallback comes back
  // wearing the right variable name.
  if (adminUrl && appUrl === adminUrl) {
    return {
      ...base,
      level: fatalIfProduction,
      event: "db_app_url_is_admin_url",
      detail:
        "APP_DATABASE_URL and DATABASE_URL are the same connection string, so the web app " +
        "connects as the admin role and row-level security is skipped exactly as if " +
        "APP_DATABASE_URL were unset. " +
        REMEDY,
      url: stance === "production" ? null : appUrl,
    };
  }

  const role = connectionRole(appUrl);
  if (role && BYPASS_ROLE_NAMES.has(role.toLowerCase())) {
    return {
      ...base,
      level: fatalIfProduction,
      event: "db_app_role_bypasses_rls",
      detail:
        `APP_DATABASE_URL connects as "${role}", which has SUPERUSER or BYPASSRLS on this ` +
        "platform and therefore ignores every row-level-security policy. " +
        REMEDY,
      url: stance === "production" ? null : appUrl,
    };
  }

  return {
    ...base,
    level: "ok",
    event: "db_app_role_ok",
    detail: role
      ? `Using APP_DATABASE_URL as "${role}".`
      : "Using APP_DATABASE_URL as the application role.",
    url: appUrl,
  };
}

/** One line of JSON, so the event is greppable in a platform log viewer. */
export function formatVerdict(verdict: DbEnvVerdict): string {
  return JSON.stringify({
    event: verdict.event,
    level: verdict.level,
    stance: verdict.stance,
    stance_from: verdict.stanceFrom,
    detail: verdict.detail,
  });
}

export interface GateIo {
  warn: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
}

/**
 * The BUILD-TIME half, called from `next.config.ts`.
 *
 * Throwing from a Next config is swallowed into a stack trace three frames
 * deep in the config loader, where it reads as a broken config rather than a
 * refused deployment. Printing the reason and exiting non-zero puts the
 * sentence a deployer needs on the last line of the build log.
 *
 * `io` is injected so the test can assert the exit rather than take the
 * process down with it.
 */
export function assertDbEnvOrExit(env: DbEnvInput, io: GateIo): DbEnvVerdict {
  const verdict = resolveDbEnv(env);
  if (verdict.level === "fatal") {
    io.error(formatVerdict(verdict));
    io.error(
      `\nBUILD REFUSED: ${verdict.detail}\n` +
        `This build declares itself production (${verdict.stanceFrom}=production). ` +
        "If it is not a production deployment — a local image, the e2e harness, a CI " +
        "build — set DEPLOY_ENV to something other than `production` at that build site.\n",
    );
    io.exit(1);
  } else if (verdict.level === "warn") {
    io.warn(formatVerdict(verdict));
  }
  return verdict;
}

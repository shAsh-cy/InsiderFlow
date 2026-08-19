import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Real Supabase sessions for the e2e suite.
 *
 * Extracted from `auth-isolation.spec.ts` when `csrf.spec.ts` needed the
 * same thing. A second copy of session-minting code is the kind of
 * duplication that rots asymmetrically: one file learns that the browser
 * sends an `Origin` header and the other does not, and the suite ends up
 * making two different claims about what a real request looks like.
 */

/**
 * Read the env the app itself uses; the Playwright process does not inherit it.
 *
 * Paths are resolved from process.cwd() (apps/web, where Playwright runs)
 * rather than from `import.meta` — the spec files are transpiled to CJS, where
 * `import.meta` is a syntax error and the whole file silently fails to load.
 */
export function readEnvFile(relativePath: string): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      out[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = { ...readEnvFile("../../.env"), ...readEnvFile(".env.local") };

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * The RLS-bound role, not the admin connection. Defaults to the URI
 * `.env.example` ships and `docker compose` creates, so this runs against the
 * reference stack with no extra setup.
 */
export const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ??
  fileEnv.APP_DATABASE_URL ??
  "postgres://insiderflow_app:insiderflow_local_dev@localhost:5433/insiderflow";

export interface AuthedUser {
  id: string;
  email: string;
  /** Cookies in exactly the encoding @supabase/ssr writes, ready for the browser. */
  cookies: Array<{ name: string; value: string }>;
}

/**
 * Sign a user up and capture the session as COOKIES.
 *
 * Deliberately not "call the API with a Bearer token": the app authenticates
 * from cookies via @supabase/ssr, so a bearer test would exercise a code path
 * that does not exist. Driving the same client with an in-memory jar produces
 * exactly the bytes the real browser would hold, without reverse-engineering
 * the cookie format.
 */
export async function signUpAndCaptureCookies(
  email: string,
  password: string,
): Promise<AuthedUser | null> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) {
    // Either password sign-up is disabled, or confirmations are on and there
    // is no session yet. Both are configuration, not a failing assertion.
    return null;
  }
  return {
    id: data.user!.id,
    email,
    cookies: [...jar].map(([name, value]) => ({ name, value })),
  };
}

/**
 * A signed-in browser context whose API requests look like a BROWSER's.
 *
 * ── WHY `extraHTTPHeaders` IS HERE AND NOT OPTIONAL ───────────────────
 *
 * Playwright's `APIRequestContext` sends no `Origin` and no `Referer`,
 * ever — measured, not assumed: a `context.request.post()` to a local
 * probe server arrives with `user-agent`, `accept`, `content-type`,
 * `host` and nothing else. A real Chromium `fetch()` POST to the same
 * server arrives with `origin: <site>` AND `referer: <page>`, because the
 * Fetch spec requires `Origin` on every request whose method is not GET
 * or HEAD, same-origin ones included.
 *
 * So `context.request` is not a browser stand-in for anything that reads
 * those headers. Once `/api/me/*` gained a same-origin gate
 * (`src/lib/security/csrf.ts`), a bare `context.request.post()` became a
 * request no browser could ever have produced, and it is refused — which
 * would have been read as "the isolation suite broke" rather than "the
 * harness was never sending what it claimed to".
 *
 * Setting `Origin` restores the fidelity the suite always assumed it had.
 * It is not a loosening: the value is the site's OWN origin, exactly what
 * the browser would put there, and `csrf.spec.ts` separately proves that
 * a DIFFERENT value is refused.
 *
 * `extraHeaders` overrides that default wholesale. Pass `{}` when a test
 * needs to control `Origin` and `Referer` itself — per-request headers
 * merge OVER the context's, and there is no per-request way to UNSET one,
 * so "no Origin at all" is only reachable by not setting it here.
 */
export async function contextFor(
  browser: import("@playwright/test").Browser,
  user: AuthedUser,
  baseURL: string,
  extraHeaders: Record<string, string> = { Origin: new URL(baseURL).origin },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: extraHeaders,
  });
  await context.addCookies(
    user.cookies.map((c) => ({ name: c.name, value: c.value, url: baseURL })),
  );
  return context;
}

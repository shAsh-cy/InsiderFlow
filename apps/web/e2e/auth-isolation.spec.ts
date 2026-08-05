import { createServerClient } from "@supabase/ssr";
import { expect, test } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { psql } from "./fixtures";

/**
 * Cross-user exploitation, with REAL sessions.
 *
 * The pre-release audit could not attempt this: with no configured Supabase
 * project there was no way to mint a session, so "user A cannot reach user B's
 * data" rested on code inspection. Inspection is exactly the method that
 * missed the inert RLS, so it is not good enough on its own.
 *
 * These tests sign up two users, obtain genuine sessions, and then try to
 * cross the boundary — read, update and delete — in both directions, plus the
 * three token shapes an attacker actually has: absent, tampered, and expired.
 *
 * They SKIP (loudly) when the deployment has no Supabase project or when email
 * confirmation is on, because a skipped test that says why is honest and a
 * test that quietly asserts nothing is not.
 */

/** Read the env the app itself uses; the Playwright process does not inherit it. */
function readEnvFile(relativePath: string): Record<string, string> {
  try {
    const raw = readFileSync(resolve(import.meta.dirname, "..", relativePath), "utf8");
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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

interface AuthedUser {
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
async function signUpAndCaptureCookies(
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

async function contextFor(
  browser: import("@playwright/test").Browser,
  user: AuthedUser,
  baseURL: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await context.addCookies(
    user.cookies.map((c) => ({ name: c.name, value: c.value, url: baseURL })),
  );
  return context;
}

const rand = () => Math.random().toString(36).slice(2, 10);

test.describe("cross-user isolation with real sessions", () => {
  test.describe.configure({ mode: "serial" });

  let userA: AuthedUser | null = null;
  let userB: AuthedUser | null = null;
  let baseURL = "";

  test.beforeAll(async ({ baseURL: configured }) => {
    baseURL = configured ?? "http://localhost:3000";
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      "No Supabase project configured — real sessions cannot be minted. " +
        "Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to run these.",
    );

    const password = `zz-e2e-${rand()}-${rand()}`;
    userA = await signUpAndCaptureCookies(`zz-e2e-a-${rand()}@insiderflow-test.invalid`, password);
    userB = await signUpAndCaptureCookies(`zz-e2e-b-${rand()}@insiderflow-test.invalid`, password);
    test.skip(
      !userA || !userB,
      "Password sign-up returned no session. Enable email+password and disable email " +
        "confirmation on the dev Supabase project to run the cross-user tests.",
    );
  });

  test.afterAll(() => {
    // Fixture rows are ZZ-namespaced; drop them so a rerun starts clean.
    for (const user of [userA, userB]) {
      if (!user) continue;
      psql(`delete from user_watchlists where user_id = '${user.id}'`);
      psql(`delete from alert_rules where user_id = '${user.id}'`);
      psql(`delete from alert_channels where user_id = '${user.id}'`);
    }
  });

  test("a signed-in user sees their own data and nobody else's", async ({ browser }) => {
    const ctxA = await contextFor(browser, userA!, baseURL);
    const ctxB = await contextFor(browser, userB!, baseURL);

    const add = await ctxA.request.post("/api/me/watchlist", {
      data: { kind: "company", refId: "ZZSECRETA", label: "A private watch", market: "US" },
    });
    expect(add.status(), "A must be able to write their own row").toBe(200);

    const mine = await (await ctxA.request.get("/api/me/watchlist")).text();
    expect(mine).toContain("ZZSECRETA");

    // The whole point: B asks for "my watchlist" and gets theirs, not A's.
    const theirs = await (await ctxB.request.get("/api/me/watchlist")).text();
    expect(theirs, "B must not see A's watchlist row").not.toContain("ZZSECRETA");

    await ctxA.close();
    await ctxB.close();
  });

  test("one user cannot delete another user's watchlist row", async ({ browser }) => {
    const ctxA = await contextFor(browser, userA!, baseURL);
    const ctxB = await contextFor(browser, userB!, baseURL);

    // B aims the delete squarely at A's row. The route takes no user id from
    // the request, so the only thing standing between them is the scoping.
    const attack = await ctxB.request.delete("/api/me/watchlist?kind=company&refId=ZZSECRETA");
    expect([200, 401, 403, 404]).toContain(attack.status());

    const stillThere = await (await ctxA.request.get("/api/me/watchlist")).text();
    expect(stillThere, "A's row must survive B's delete").toContain("ZZSECRETA");

    await ctxA.close();
    await ctxB.close();
  });

  test("one user cannot read, rename, or delete another user's alert rule", async ({ browser }) => {
    const ctxA = await contextFor(browser, userA!, baseURL);
    const ctxB = await contextFor(browser, userB!, baseURL);

    const created = await ctxA.request.post("/api/me/alert-rules", {
      data: { name: "ZZ A private rule", trackedTicker: "ZZNOVA", channels: ["telegram"] },
    });
    expect(created.status()).toBe(201);
    const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

    // Read.
    const bList = await (await ctxB.request.get("/api/me/alert-rules")).text();
    expect(bList).not.toContain("ZZ A private rule");
    expect(bList).not.toContain(ruleId);

    // Write, with A's real rule id — the strongest form of the attack, since
    // B is not guessing anything.
    const rename = await ctxB.request.patch("/api/me/alert-rules", {
      data: { id: ruleId, name: "hijacked by B" },
    });
    expect([200, 401, 403, 404]).toContain(rename.status());

    const destroy = await ctxB.request.delete(`/api/me/alert-rules?id=${ruleId}`);
    expect([200, 401, 403, 404]).toContain(destroy.status());

    const aList = await (await ctxA.request.get("/api/me/alert-rules")).text();
    expect(aList, "A's rule must still exist").toContain(ruleId);
    expect(aList, "A's rule must keep its name").toContain("ZZ A private rule");
    expect(aList).not.toContain("hijacked by B");

    await ctxA.close();
    await ctxB.close();
  });

  test("the database refuses cross-user reads even below the query layer", async () => {
    // Belt and braces for the API tests above: run as the RLS-bound app role
    // with A's context and ask for everything. Under the configuration the
    // audit found, this returned every user's rows.
    const output = psql(
      `set role insiderflow_app; ` +
        `select set_config('app.user_id', '${userA!.id}', false); ` +
        `select count(*) from user_watchlists where user_id = '${userB!.id}'`,
    );
    const lastLine = output.trim().split("\n").pop()?.trim();
    expect(lastLine, `expected 0 of B's rows visible in A's context, got: ${output}`).toBe("0");

    // And the mirror: A's own rows ARE visible, so the zero above is isolation
    // rather than the policies simply blocking everything.
    const own = psql(
      `set role insiderflow_app; ` +
        `select set_config('app.user_id', '${userA!.id}', false); ` +
        `select count(*) from user_watchlists where user_id = '${userA!.id}'`,
    );
    expect(Number(own.trim().split("\n").pop())).toBeGreaterThan(0);
  });

  test("rejects absent, tampered, and expired tokens", async ({ browser, request }) => {
    // Absent.
    expect((await request.get("/api/me/watchlist")).status()).toBe(401);

    // Tampered: A's real cookie with the JWT mutated. getUser() validates the
    // signature against the Auth server, so this must not authenticate.
    const tampered = await browser.newContext({ baseURL });
    await tampered.addCookies(
      userA!.cookies.map((c) => ({
        name: c.name,
        // Flip a character in the middle. Base64url alphabet, so still a
        // structurally plausible token — only the signature stops it.
        value: c.value.slice(0, 40) + (c.value[40] === "A" ? "B" : "A") + c.value.slice(41),
        url: baseURL,
      })),
    );
    expect(
      (await tampered.request.get("/api/me/watchlist")).status(),
      "a tampered session cookie must not authenticate",
    ).toBe(401);
    await tampered.close();

    // Expired: a well-formed JWT whose exp is in the past.
    const expiredJwt = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(
        JSON.stringify({ sub: userA!.id, exp: Math.floor(Date.now() / 1000) - 3600 }),
      ).toString("base64url"),
      "not-a-real-signature",
    ].join(".");
    const expired = await browser.newContext({ baseURL });
    await expired.addCookies(
      userA!.cookies.map((c) => ({
        name: c.name,
        value: `base64-${Buffer.from(JSON.stringify({ access_token: expiredJwt, token_type: "bearer", expires_in: 0, refresh_token: "zz-expired", user: { id: userA!.id } })).toString("base64url")}`,
        url: baseURL,
      })),
    );
    expect(
      (await expired.request.get("/api/me/watchlist")).status(),
      "an expired session must not authenticate",
    ).toBe(401);
    await expired.close();
  });

  test("signing out restores the signed-out contract", async ({ browser }) => {
    const ctx = await contextFor(browser, userB!, baseURL);
    expect((await ctx.request.get("/api/me/watchlist")).status()).toBe(200);

    await ctx.request.post("/auth/signout");

    expect(
      (await ctx.request.get("/api/me/watchlist")).status(),
      "sign-out must clear the session cookies, not just the client state",
    ).toBe(401);
    await ctx.close();
  });
});

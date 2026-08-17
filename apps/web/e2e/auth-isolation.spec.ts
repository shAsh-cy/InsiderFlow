import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import {
  alertChannels,
  alertRules,
  createDbHandle,
  userWatchlists,
  withUserContext,
} from "@insiderflow/db";

import { psql } from "./fixtures";
import {
  APP_DATABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  contextFor,
  signUpAndCaptureCookies,
} from "./session";
import type { AuthedUser } from "./session";

/**
 * Cross-user exploitation, with REAL sessions.
 *
 * The pre-release audit could not attempt this: with no configured Supabase
 * project there was no way to mint a session, so "user A cannot reach user B's
 * data" rested on code inspection. Inspection is exactly the method that
 * missed the inert RLS, so it is not good enough on its own.
 *
 * What this file attacks, and why each piece is here:
 *
 *   - BOTH directions. A→B and B→A are separate code paths only in the sense
 *     that a bug can be asymmetric — a first-created user, a cached handle, a
 *     connection that happens to still carry the previous GUC. Running the
 *     matrix twice costs seconds and removes the assumption.
 *   - EVERY user-scoped route: watchlist, alert rules, and channels, reads and
 *     writes alike, using the victim's REAL row ids so the attacker is never
 *     merely guessing.
 *   - EVERY route against all three token shapes an attacker actually holds:
 *     absent, tampered (a real session whose JWT signature was altered) and
 *     expired. A control asserts the same cookie authenticates BEFORE
 *     tampering, so a 401 cannot come from our re-encoding.
 *   - The DATABASE layer, through `withUserContext` itself and the NOBYPASSRLS
 *     application role, with the `user_id` predicate deliberately removed —
 *     the one query shape that has nothing left but row-level security.
 *
 * They SKIP (loudly) when the deployment has no Supabase project or when email
 * confirmation is on, because a skipped test that says why is honest and a
 * test that quietly asserts nothing is not.
 */

/**
 * The session-minting helpers moved to `./session` when `csrf.spec.ts`
 * needed the same ones. `contextFor` there now also sets an `Origin`
 * header, because Playwright's `APIRequestContext` sends none and a real
 * browser always does on a mutation — see that file for the measurement.
 * Nothing asserted below changed; the requests simply stopped being ones
 * no browser could have made.
 */

// ── Session cookie surgery ──────────────────────────────────────────────────
//
// @supabase/ssr stores the session as `base64-<base64url(JSON)>`, split across
// `<name>.0`, `<name>.1`… when it exceeds the per-cookie size limit. To tamper
// with the JWT precisely — rather than corrupting random bytes and watching a
// parse failure produce a 401 that proves nothing — we reassemble, edit, and
// write the result back as one cookie.

interface StoredSession {
  cookieName: string;
  session: { access_token: string; refresh_token: string; [key: string]: unknown };
}

/**
 * `sb-<ref>-auth-token`, optionally suffixed `.0`, `.1`… when chunked.
 *
 * Anchored on `-auth-token` deliberately. The jar also holds PKCE
 * `…-code-verifier` cookies which are ALSO `base64-` encoded JSON, and picking
 * the first base64 cookie silently grabbed one of those — producing a context
 * with no session at all, which returns 401 for reasons that have nothing to
 * do with the tampering under test. The control assertion below exists because
 * that is exactly what happened.
 */
const AUTH_COOKIE_RE = /-auth-token(\.\d+)?$/;
/** @supabase/ssr splits a value longer than this across numbered cookies. */
const MAX_COOKIE_CHUNK = 3180;

function readStoredSession(cookies: Array<{ name: string; value: string }>): StoredSession | null {
  try {
    const parts = cookies
      .filter((c) => AUTH_COOKIE_RE.test(c.name))
      .sort((a, b) => Number(a.name.split(".").pop() ?? 0) - Number(b.name.split(".").pop() ?? 0));
    if (parts.length === 0) return null;
    const cookieName = parts[0]!.name.replace(/\.\d+$/, "");
    const raw = parts.map((c) => c.value).join("");
    if (!raw.startsWith("base64-")) return null;
    const json = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
    const session = JSON.parse(json) as StoredSession["session"];
    if (typeof session?.access_token !== "string") return null;
    return { cookieName, session };
  } catch {
    return null;
  }
}

function writeStoredSession(stored: StoredSession): Array<{ name: string; value: string }> {
  const value = `base64-${Buffer.from(JSON.stringify(stored.session), "utf8").toString("base64url")}`;
  if (value.length <= MAX_COOKIE_CHUNK) return [{ name: stored.cookieName, value }];
  const chunks: Array<{ name: string; value: string }> = [];
  for (let i = 0; i * MAX_COOKIE_CHUNK < value.length; i += 1) {
    chunks.push({
      name: `${stored.cookieName}.${i}`,
      value: value.slice(i * MAX_COOKIE_CHUNK, (i + 1) * MAX_COOKIE_CHUNK),
    });
  }
  return chunks;
}

/** Flip one character of the JWT SIGNATURE, leaving a structurally valid token. */
function tamperSignature(jwt: string): string {
  const parts = jwt.split(".");
  const signature = parts[2] ?? "";

  // Flip a bit in a middle BYTE, not a character at the end.
  //
  // This used to swap the final base64url character between "A" and "B".
  // A 256-bit HMAC encodes to 43 base64url characters, and the last of
  // those carries four significant bits plus two of padding — "A" and "B"
  // differ only in a padding bit, so whenever the real signature happened
  // to end in "A" the "tampered" token decoded to exactly the original
  // bytes and authenticated correctly. That is ~1 run in 16, and it
  // presented as a rare, alarming "the API accepted a forged token"
  // failure that was really the test failing to forge one.
  //
  // Decoding to bytes and flipping one makes the change unambiguous, and
  // the assertion below refuses to run at all if it somehow did not.
  const bytes = Buffer.from(signature, "base64url");
  const mid = Math.floor(bytes.length / 2);
  bytes[mid] = (bytes[mid] ?? 0) ^ 0xff;
  const tampered = bytes.toString("base64url");
  if (tampered === signature) throw new Error("tamperSignature did not change the signature");

  return [parts[0], parts[1], tampered].join(".");
}

/** A well-formed JWT for this user whose `exp` is an hour in the past. */
function expiredJwtFor(userId: string): string {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) - 3600 }),
    ).toString("base64url"),
    "not-a-real-signature",
  ].join(".");
}

// ── The user-scoped route surface ───────────────────────────────────────────
//
// Every route under /api/me. An anonymous or forged caller must be turned away
// by ALL of them — a single route that checks the session late, or not at all,
// is the whole boundary. Bodies are deliberately well-formed so a 400 can
// never stand in for the 401 we are asserting.

const FORGED_RULE_ID = "00000000-0000-4000-8000-0000000ff0f0";

interface RouteProbe {
  label: string;
  send: (api: APIRequestContext) => Promise<APIResponse>;
}

const ME_ROUTES: RouteProbe[] = [
  { label: "GET /api/me/watchlist", send: (r) => r.get("/api/me/watchlist") },
  {
    label: "POST /api/me/watchlist",
    send: (r) =>
      r.post("/api/me/watchlist", {
        data: { kind: "company", refId: "ZZFORGED", label: "forged", market: "US" },
      }),
  },
  {
    label: "DELETE /api/me/watchlist",
    send: (r) => r.delete("/api/me/watchlist?kind=company&refId=ZZFORGED"),
  },
  { label: "GET /api/me/alert-rules", send: (r) => r.get("/api/me/alert-rules") },
  {
    label: "POST /api/me/alert-rules",
    send: (r) =>
      r.post("/api/me/alert-rules", { data: { name: "ZZ forged rule", channels: ["telegram"] } }),
  },
  {
    label: "PATCH /api/me/alert-rules",
    send: (r) =>
      r.patch("/api/me/alert-rules", { data: { id: FORGED_RULE_ID, name: "ZZ forged rename" } }),
  },
  {
    label: "DELETE /api/me/alert-rules",
    send: (r) => r.delete(`/api/me/alert-rules?id=${FORGED_RULE_ID}`),
  },
  { label: "GET /api/me/channels", send: (r) => r.get("/api/me/channels") },
  {
    label: "POST /api/me/channels",
    send: (r) => r.post("/api/me/channels", { data: { action: "link-telegram" } }),
  },
  {
    label: "PATCH /api/me/channels",
    send: (r) =>
      r.patch("/api/me/channels", { data: { channel: "telegram", digestHour: "09:00" } }),
  },
];

const rand = () => Math.random().toString(36).slice(2, 10);

test.describe("cross-user isolation with real sessions", () => {
  test.describe.configure({ mode: "serial" });

  let userA: AuthedUser | null = null;
  let userB: AuthedUser | null = null;
  let baseURL = "";

  /**
   * Announce a skip on stdout as well as in the annotation. Playwright's list
   * reporter prints "6 skipped" and nothing else, which is indistinguishable
   * from "6 passed trivially" to anyone reading CI output — precisely the
   * silence this suite exists to end.
   */
  const skipLoudly = (condition: boolean, reason: string): void => {
    if (condition)
      console.warn(`
[auth-isolation] SKIPPED — ${reason}
`);
    test.skip(condition, reason);
  };

  test.beforeAll(async ({ baseURL: configured }) => {
    baseURL = configured ?? "http://localhost:3000";
    skipLoudly(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      "No Supabase project configured, so real sessions cannot be minted. " +
        "Cross-user isolation is therefore UNVERIFIED on this run. Set " +
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to run these.",
    );

    const password = `zz-e2e-${rand()}-${rand()}`;
    userA = await signUpAndCaptureCookies(`zz-e2e-a-${rand()}@insiderflow-test.invalid`, password);
    userB = await signUpAndCaptureCookies(`zz-e2e-b-${rand()}@insiderflow-test.invalid`, password);
    skipLoudly(
      !userA || !userB,
      "Password sign-up returned no session, so cross-user isolation is UNVERIFIED. " +
        "Enable email+password and disable email confirmation on the dev Supabase project.",
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
    psql(`delete from user_watchlists where ref_id in ('ZZFORGED')`);
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

  // ── The attack matrix, run once in each direction ─────────────────────────
  //
  // A bug here can be asymmetric — the first user created, a warm connection
  // still carrying the previous request's GUC, an ordering assumption in a
  // cached handle. Testing one direction and inferring the other is the same
  // kind of reasoning that certified the inert RLS as working.
  for (const direction of [
    { attacker: "B", victim: "A" },
    { attacker: "A", victim: "B" },
  ] as const) {
    const { attacker, victim } = direction;
    const users = () => ({
      attackerUser: (attacker === "A" ? userA : userB)!,
      victimUser: (victim === "A" ? userA : userB)!,
    });
    const secretRef = `ZZSECRET${victim}`;
    const ruleName = `ZZ ${victim} private rule`;
    const victimZone = `ZZ/${victim}-only`;

    test.describe(`${attacker} attacks ${victim}`, () => {
      test(`${attacker} cannot see or delete ${victim}'s watchlist row`, async ({ browser }) => {
        const { attackerUser, victimUser } = users();
        const ctxAttacker = await contextFor(browser, attackerUser, baseURL);
        const ctxVictim = await contextFor(browser, victimUser, baseURL);

        const add = await ctxVictim.request.post("/api/me/watchlist", {
          data: {
            kind: "company",
            refId: secretRef,
            label: `${victim} private watch`,
            market: "US",
          },
        });
        expect(add.status(), `${victim} must be able to write their own row`).toBe(200);

        const seen = await (await ctxAttacker.request.get("/api/me/watchlist")).text();
        expect(seen, `${attacker} must not see ${victim}'s watchlist row`).not.toContain(secretRef);

        // The delete aims squarely at the victim's row. The route takes no user
        // id from the request, so the only thing between them is the scoping.
        //
        // 200 is the CORRECT status, and deliberately so: a 404 would tell the
        // attacker whether the row exists, turning the endpoint into an
        // existence oracle. The response is identical either way; the effect is
        // what differs, which is what the next assertion checks.
        const attack = await ctxAttacker.request.delete(
          `/api/me/watchlist?kind=company&refId=${secretRef}`,
        );
        expect(attack.status()).toBe(200);

        const survives = await (await ctxVictim.request.get("/api/me/watchlist")).text();
        expect(survives, `${victim}'s row must survive ${attacker}'s delete`).toContain(secretRef);

        await ctxAttacker.close();
        await ctxVictim.close();
      });

      test(`${attacker} cannot read, rename, or delete ${victim}'s alert rule`, async ({
        browser,
      }) => {
        const { attackerUser, victimUser } = users();
        const ctxAttacker = await contextFor(browser, attackerUser, baseURL);
        const ctxVictim = await contextFor(browser, victimUser, baseURL);

        const created = await ctxVictim.request.post("/api/me/alert-rules", {
          data: { name: ruleName, trackedTicker: "ZZNOVA", channels: ["telegram"] },
        });
        expect(created.status()).toBe(201);
        const ruleId = ((await created.json()) as { data: { id: string } }).data.id;

        // Read.
        const list = await (await ctxAttacker.request.get("/api/me/alert-rules")).text();
        expect(list).not.toContain(ruleName);
        expect(list).not.toContain(ruleId);

        // Write, with the victim's REAL rule id — the strongest form of the
        // attack, since the attacker is not guessing anything.
        const rename = await ctxAttacker.request.patch("/api/me/alert-rules", {
          data: { id: ruleId, name: `hijacked by ${attacker}` },
        });
        expect(rename.status()).toBe(200);

        const destroy = await ctxAttacker.request.delete(`/api/me/alert-rules?id=${ruleId}`);
        expect(destroy.status()).toBe(200);

        const after = await (await ctxVictim.request.get("/api/me/alert-rules")).text();
        expect(after, `${victim}'s rule must still exist`).toContain(ruleId);
        expect(after, `${victim}'s rule must keep its name`).toContain(ruleName);
        expect(after).not.toContain(`hijacked by ${attacker}`);

        await ctxAttacker.close();
        await ctxVictim.close();
      });

      test(`${attacker} cannot see or alter ${victim}'s alert channel`, async ({ browser }) => {
        const { attackerUser, victimUser } = users();
        const ctxAttacker = await contextFor(browser, attackerUser, baseURL);
        const ctxVictim = await contextFor(browser, victimUser, baseURL);

        // Create the victim's channel row the way the product does. Without a
        // bot username configured the route answers 503, so fall back to the
        // row the route would have written — the isolation claim under test is
        // about the row, not about how it got there.
        const link = await ctxVictim.request.post("/api/me/channels", {
          data: { action: "link-telegram" },
        });
        // ── THE RULE, so nobody "tightens" this again ─────────────────
        //
        // A multi-status assertion is a BUG when one of the accepted
        // answers IS the failure state and nothing downstream
        // distinguishes them. It is LEGITIMATE when both branches are
        // handled and the actual subject is asserted identically either
        // way. `scripts/lint-e2e-assertions.mjs` enforces that: a status
        // array in a spec must be listed there with a justification.
        //
        // EXAMINED in the r12 assertion sweep and deliberately LEFT as a
        // two-status acceptance — the one candidate that turned out not to
        // be an instance of the class.
        //
        // I did tighten it first, to `botConfigured ? 200 : 503` read from
        // `process.env.TELEGRAM_BOT_USERNAME`, and that was the same
        // mistake this phase already made once: the RUNNER's environment
        // is not the SERVER's. The server reads .env.local; the runner
        // does not, so the "tightened" version demanded 503 from a server
        // that was correctly answering 200.
        //
        // The difference from the auth.spec case that hid an open webhook:
        // there, one of the two permitted statuses WAS the vulnerability,
        // and nothing downstream distinguished them. Here both branches
        // are handled, the 503 branch writes the row the route would have
        // written, and the claim under test — that user B cannot see or
        // alter user A's channel — is asserted identically either way. The
        // status is a precondition, not the subject.
        expect(
          [200, 503],
          "link-telegram must either issue a deep link or say it is unconfigured",
        ).toContain(link.status());
        if (link.status() === 503) {
          psql(
            `insert into alert_channels (user_id, channel, verified)
             values ('${victimUser.id}', 'telegram', false)
             on conflict (user_id, channel) do nothing`,
          );
        }

        const prefs = await ctxVictim.request.patch("/api/me/channels", {
          data: { channel: "telegram", digestHour: "04:00", timezone: victimZone },
        });
        expect(prefs.status()).toBe(200);

        const seen = await (await ctxAttacker.request.get("/api/me/channels")).text();
        expect(seen, `${attacker} must not see ${victim}'s channel preferences`).not.toContain(
          victimZone,
        );
        // The route maps its columns explicitly for this reason; assert it, so
        // adding a `select *` is caught here rather than in someone's logs.
        expect(seen, "channel tokens must never reach the client").not.toContain("linkToken");
        expect(seen, "channel tokens must never reach the client").not.toContain(
          "unsubscribeToken",
        );

        const hijack = await ctxAttacker.request.patch("/api/me/channels", {
          data: { channel: "telegram", digestHour: "23:00", timezone: "ZZ/hijacked" },
        });
        expect(hijack.status()).toBe(200);

        const after = await (await ctxVictim.request.get("/api/me/channels")).text();
        expect(after, `${victim}'s timezone must be untouched`).toContain(victimZone);
        expect(after).not.toContain("ZZ/hijacked");

        await ctxAttacker.close();
        await ctxVictim.close();
      });
    });
  }

  // ── Below the query layer ─────────────────────────────────────────────────

  test("the database refuses cross-user reads even below the query layer", async () => {
    // Every statement here omits the `user_id` predicate that user-queries.ts
    // always includes. That is the point: with layer 1 removed, the only thing
    // left is row-level security, evaluated for the NOBYPASSRLS role the web
    // app actually connects as. Under the configuration the audit found, these
    // returned every user's rows.
    const handle = createDbHandle(APP_DATABASE_URL);
    try {
      const outside = await handle.db.select().from(userWatchlists);
      expect(outside.length, "with no user context the app role must see no user rows at all").toBe(
        0,
      );

      const pairs: Array<[AuthedUser, AuthedUser]> = [
        [userA!, userB!],
        [userB!, userA!],
      ];
      for (const [self, other] of pairs) {
        const watchlist = await withUserContext(handle.db, self.id, (tx) =>
          tx.select().from(userWatchlists),
        );
        expect(watchlist.length, "the caller's own rows must be visible").toBeGreaterThan(0);
        expect(
          watchlist.filter((row) => row.userId !== self.id),
          "an unscoped select inside a user context returned somebody else's rows",
        ).toEqual([]);

        const rules = await withUserContext(handle.db, self.id, (tx) =>
          tx.select().from(alertRules),
        );
        expect(rules.length).toBeGreaterThan(0);
        expect(rules.filter((row) => row.userId !== self.id)).toEqual([]);
        expect(rules.filter((row) => row.userId === other.id)).toEqual([]);

        const channels = await withUserContext(handle.db, self.id, (tx) =>
          tx.select().from(alertChannels),
        );
        expect(channels.filter((row) => row.userId !== self.id)).toEqual([]);
      }
    } finally {
      await handle.end();
    }
  });

  // ── Token shapes, against every route ─────────────────────────────────────
  //
  // The three contexts below are built WITHOUT the `Origin` header
  // `contextFor` adds, and deliberately so. Every assertion here is 401,
  // and 401 is only the answer if the session check runs BEFORE the
  // same-origin check on all seven mutating `/api/me/*` handlers —
  // watchlist POST and DELETE, alert-rules POST, PATCH and DELETE,
  // channels POST and PATCH, which is what ME_ROUTES enumerates. Reorder
  // them and these turn 403 and this file goes red — a free guard on the
  // ordering `src/lib/security/csrf.ts` argues for, paid for by nothing.
  //
  // `POST /auth/signout` is the eighth gated handler and is NOT in that
  // list: it has no session check to sit behind, so it answers 403 to an
  // anonymous cross-origin caller by design. `e2e/csrf.spec.ts` owns it.

  test("every /api/me route rejects an absent token", async ({ request }) => {
    for (const route of ME_ROUTES) {
      const response = await route.send(request);
      expect(response.status(), `${route.label} with no session`).toBe(401);
    }
  });

  test("every /api/me route rejects a tampered token", async ({ browser }) => {
    const stored = readStoredSession(userA!.cookies);
    expect(
      stored,
      "could not decode the Supabase session cookie — the format changed and this test " +
        "would otherwise assert nothing",
    ).not.toBeNull();

    // CONTROL. Re-encoding the session as a single cookie must still
    // authenticate, so the 401s below are caused by the tampering and not by
    // our surgery.
    const control = await browser.newContext({ baseURL });
    await control.addCookies(writeStoredSession(stored!).map((c) => ({ ...c, url: baseURL })));
    expect(
      (await control.request.get("/api/me/watchlist")).status(),
      "the re-encoded, UNtampered session must still authenticate",
    ).toBe(200);
    await control.close();

    // The refresh token is neutralised alongside the signature, for the same
    // reason the expired-token test below does it: @supabase/ssr responds to a
    // rejected access token by trying to REFRESH it, and a valid refresh token
    // legitimately mints a new session — so the assertion below would
    // sometimes be measuring a successful refresh rather than a rejected
    // signature. It raced, and it failed roughly one run in twenty under
    // parallel load, which is exactly what a test that occasionally measures
    // the wrong thing looks like. Isolating the tampering is what makes the
    // 401 mean "the signature was checked".
    const tampered = await browser.newContext({ baseURL });
    await tampered.addCookies(
      writeStoredSession({
        cookieName: stored!.cookieName,
        session: {
          ...stored!.session,
          access_token: tamperSignature(stored!.session.access_token),
          refresh_token: "zz-not-a-refresh-token",
        },
      }).map((c) => ({ ...c, url: baseURL })),
    );
    for (const route of ME_ROUTES) {
      const response = await route.send(tampered.request);
      expect(response.status(), `${route.label} with a tampered JWT signature`).toBe(401);
    }
    await tampered.close();
  });

  test("every /api/me route rejects an expired token", async ({ browser }) => {
    const stored = readStoredSession(userA!.cookies);
    expect(stored, "could not decode the Supabase session cookie").not.toBeNull();

    // Expired access token AND an unusable refresh token: a session that has
    // merely expired is supposed to be refreshed, so the attack shape is one
    // where refresh cannot rescue it.
    const expired = await browser.newContext({ baseURL });
    await expired.addCookies(
      writeStoredSession({
        cookieName: stored!.cookieName,
        session: {
          ...stored!.session,
          access_token: expiredJwtFor(userA!.id),
          refresh_token: "zz-not-a-refresh-token",
          expires_in: 0,
          expires_at: Math.floor(Date.now() / 1000) - 3600,
        },
      }).map((c) => ({ ...c, url: baseURL })),
    );
    for (const route of ME_ROUTES) {
      const response = await route.send(expired.request);
      expect(response.status(), `${route.label} with an expired session`).toBe(401);
    }
    await expired.close();

    // None of the forged writes above may have landed.
    expect(
      psql(`select count(*) from user_watchlists where ref_id = 'ZZFORGED'`).trim(),
      "a forged request wrote a row",
    ).toBe("0");
    expect(
      psql(`select count(*) from alert_rules where name = 'ZZ forged rule'`).trim(),
      "a forged request created a rule",
    ).toBe("0");
  });

  test("signing out restores the signed-out contract", async ({ browser }) => {
    const ctx = await contextFor(browser, userB!, baseURL);
    expect((await ctx.request.get("/api/me/watchlist")).status()).toBe(200);

    await ctx.request.post("/auth/signout");

    for (const route of ME_ROUTES) {
      expect(
        (await route.send(ctx.request)).status(),
        `${route.label} after sign-out — the cookies must be cleared, not just client state`,
      ).toBe(401);
    }
    await ctx.close();
  });
});

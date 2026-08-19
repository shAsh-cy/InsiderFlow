# Deployment state — PAUSED

**Checkpoint date:** 2026-08-06
**Branch:** `main` @ `888d622` (`merge: audit remediation and cross-user isolation closeout`)
**CI:** green — [run 31029669123](https://github.com/shAsh-cy/InsiderFlow/actions/runs/31029669123), both jobs including the required `image-secret-scan` gate

> ## ⛔ DO NOT DEPLOY
>
> Production deployment is **deliberately paused**. Until this file says
> otherwise, no session should run a deploy, a login, a migration against a
> remote database, or any other infrastructure command. Feature, UI, test and
> security work on branches is fine — see [Docs-only discipline](#docs-only-discipline).

This file exists so a future session can resume Part 2 of the deployment
exactly where it stopped, with no rediscovery and no code changes. It is the
checkpoint, not the deployment report: `DEPLOYMENT_REPORT.md` is the intended
_output_ of Part 2 and does not exist yet.

---

## Status summary

|                                |                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Audit remediation              | Merged to `main` (`--no-ff`, 12 commits, narrative preserved). CI green.       |
| **Part 1 — closeout**          | ✅ **COMPLETE.** Cross-user isolation suite passes **12/12**, 0 skipped.       |
| **Part 2 — production deploy** | ⏸️ **PAUSED, NOT STARTED.** Nothing has been provisioned, linked, or deployed. |

Part 2 covers: Supabase production database behind the transaction pooler,
Vercel (`apps/web`), the Cloudflare `edgar-worker` with its two cron triggers,
and the GitHub Actions scheduled workflows.

### What Part 1 established

- `e2e/auth-isolation.spec.ts` runs instead of skipping: both directions (A→B
  and B→A), all three `/api/me/*` routes, all 10 route+method pairs against
  absent / tampered / expired tokens, and a database-layer assertion made
  through `withUserContext` itself over the `NOBYPASSRLS` application role.
- It is **mutation-tested**, not merely green. With `BYPASSRLS` granted to
  `insiderflow_app`, the DB-layer test fails with `Expected: 0, Received: 2`
  while the seven API-level attacks still pass — the query-layer scoping and
  the RLS backstop are provably independent controls.
- Full verification at that commit: **272 unit/integration passed** (0 failed,
  28 files), **102 e2e passed with 0 skipped** against a stack rebuilt from
  `docker compose down -v`, all seven screener presets and the leaderboard
  populated.
- Details and evidence: `AUDIT.md` → _Closeout: cross-user isolation, verified_.

---

## Done vs Blocked-on-user vs Untouched

### ✅ Done

- Part 1 cross-user isolation closeout (12/12) — merged and pushed.
- `main` merged, pushed, CI green including the image-secret gate.
- Repository is **public** at <https://github.com/shAsh-cy/InsiderFlow>.
  Git history was scanned for secrets before the first push: no `.env` /
  `.dev.vars` file has ever been committed, and no live token value appears in
  any reachable commit.
- CLIs installed locally (see [Environment](#environment--cli-install-state)).

### ⏸️ Blocked on the user — interactive or secret-bearing, cannot be done for them

1. **Create `.env.production.local`** at the repo root (gitignored by
   `.gitignore:19` → `.env.*`) containing the Supabase **transaction pooler**
   connection string, port **6543** — not the direct connection:

   ```
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres
   OPS_TELEGRAM_CHAT_ID=<optional; @userinfobot on Telegram returns it>
   ```

   Dashboard → project → **Connect** → **Transaction pooler**. The project ref
   is the one already in `apps/web/.env.local` as `NEXT_PUBLIC_SUPABASE_URL`.

2. **Three interactive logins**, each of which opens a browser:

   ```
   vercel login
   pnpm --filter @insiderflow/edgar-worker exec wrangler login
   gh auth login
   ```

### ⬜ Untouched / not started

- Vercel: project not linked, no environment variables set, no deployment.
- Supabase production: **no migrations run**, `insiderflow_app` role not
  created there, RLS enforcement never proven against the real pooler.
- Supabase Auth URL configuration for a production origin (Site URL +
  redirect allow-list) — unchanged; only `localhost` entries exist.
- GitHub OAuth: no separate production OAuth app created.
- Cloudflare: worker never deployed, no `wrangler secret put` performed,
  cron triggers not live.
- GitHub Actions: **no repository secrets set**, so every scheduled workflow
  would fail if it fired. Schedules are registered by virtue of being on the
  default branch — see the note in the runbook.
- `DEPLOYMENT_REPORT.md`: does not exist. It is the deliverable of Part 2.

---

## Open risk to measure FIRST

> Measure this **before** any other Part 2 step. It is cheap, it is invisible
> from the local stack by construction, and it determines whether alerting
> works in production at all.

### The risk

The alert scanner and dispatcher read `alert_rules` and `alert_channels` on the
**admin** connection with **no user context**:

- `packages/alerts/src/scanner.ts:275` — `.from(alertRules).where(enabled = true …)`
- `packages/alerts/src/scanner.ts:421` — `.from(alertChannels)`
- `packages/alerts/src/dispatch.ts:266` — `.select().from(alertChannels).where(inArray(userId, …))`

That is deliberate: those jobs are not request paths and have no single user to
scope to. It works **only** because the admin role bypasses row-level security.

Migration `0009_rls_enforced.sql` sets `FORCE ROW LEVEL SECURITY` on all four
user tables, which makes even the table **owner** subject to its own policies.
Locally this is harmless: Docker's `postgres` is a true superuser and superusers
always bypass RLS. **Supabase's `postgres` role is not a superuser.** If it also
lacks `BYPASSRLS`, then in production:

- the scanner reads **zero rows**,
- no error is raised,
- alerts silently never fire, and
- `/api/health` still reports green.

A silent zero is the worst failure shape available, and no local test can
surface it.

### The exact check to run later (do not run it now)

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'postgres';
```

The minimal form named in the task, verbatim:

```sql
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'postgres';
```

Follow it with an affirmative probe rather than trusting the flag — insert a
row as admin and confirm the admin connection can read it back with no
`app.user_id` set. `packages/db/scripts/bootstrap.mjs` already runs the mirror
of this probe for the _application_ role (`no context → 0 rows; owner context →
1 row; other user → 0 rows`); it does **not** currently check the admin
direction, which is the gap this risk sits in.

### r14 status: the scanner-side fix is IMPLEMENTED, not yet deploy-verified

The over-read this risk describes has been closed in code, and the closure is
proved locally against the real migrations — but not against Supabase, because
there is no Supabase project yet. **Both halves of that sentence matter at
resume time.**

What shipped (branch `chore/r14-security-checklist`):

- `withUserContextAsApp()` in `packages/db/src/user-context.ts` — `SET LOCAL
ROLE insiderflow_app` plus `set_config('app.user_id', …, true)`, both
  transaction-scoped so neither can outlive the transaction. That is what makes
  it safe behind the 6543 transaction pooler; a session-level `SET ROLE` there
  is a bug that only appears under load.
- `packages/alerts/src/scanner.ts` — `loadRules` and `loadTimezones` now read
  one user at a time through that helper. The only remaining cross-user read is
  `usersWithRules()`, which selects `user_id` and nothing else.
- `packages/db/src/scanner-scope.test.ts` — 8 tests over the real migrations:
  only the target user's rows come back, ZERO rows when `app.user_id` is unset,
  `alert_channels` scoped too, the app role is NOBYPASSRLS, and the context does
  not survive its own transaction.

**Run these at resume, in this order. Do not tick the RLS risk closed without
them.**

1. The `pg_roles` check above, for `postgres` AND for `insiderflow_app`.
   `insiderflow_app` must be `rolbypassrls = false` and `rolsuper = false` on
   the hosted project, not only in the migration.
2. Through the **6543 transaction pooler**, not the direct 5432 connection:
   run a scan and confirm `SET LOCAL ROLE` + `set_config(..., true)` behave as
   they do locally. This is the one behaviour PGlite cannot speak to, and it is
   the reason the helper uses LOCAL rather than session scope.
3. The affirmative probe, admin direction: with `app.user_id` unset, confirm a
   scoped read returns 0 rows on the real database.
4. Confirm the scanner still delivers — the per-user loop is a behavioural
   change to a cron job, and "no alerts fired" would be the failure mode.

If the hosted `postgres` role is BYPASSRLS (it is, on Supabase), that is now
EXPECTED rather than alarming: the scanner no longer reads user tables on that
role. The mitigations below remain relevant only for whatever still does.

### Mitigations to evaluate if `rolbypassrls` is false

Evaluate in this order; do not pick one without measuring first.

1. **Confirm the admin role already bypasses.** If `rolbypassrls = true`, there
   is nothing to fix — record the evidence and move on. This is the expected
   outcome and costs one query.
2. **Have the scanner connect as a role that bypasses RLS.** A dedicated
   `insiderflow_scanner` role with `BYPASSRLS`, distinct from both the app role
   and the migration owner. Narrowest privilege change that keeps the current
   code correct.
3. **Give the scanner an explicit service context.** Add a service-level policy
   (e.g. a `app.service` GUC checked by an additional `USING` clause) and wrap
   the scanner's reads in it. More code, but it keeps `FORCE RLS` meaningful for
   every connection and leaves no role that ignores policies.
4. **Do not** simply drop `FORCE ROW LEVEL SECURITY` to make the symptom go
   away. That reverts MAJOR-1 — the exact defect the audit found inert — and
   the mutation test in `e2e/auth-isolation.spec.ts` exists to catch it.

Whichever path is taken, add the admin-direction assertion to
`bootstrap.mjs` so the next deployment cannot regress into a silent zero.

### Secondary risks noted during planning (unmeasured)

- **Pooler username format.** Supabase's transaction pooler (Supavisor) routes
  by username: it expects `<role>.<project-ref>`, e.g.
  `insiderflow_app.<project-ref>`, not a bare `insiderflow_app`.
  `packages/db/scripts/app-role.mjs:78-81` builds its suggested connection
  string by swapping only the username (`url.username = roleName`), so the
  string it prints will be wrong for Supabase. It is informational output, not
  a functional path, but a deployer following it verbatim will get an
  authentication failure with a confusing message. Verify the real form before
  writing `APP_DATABASE_URL` anywhere.
- **Whether Supavisor accepts custom Postgres roles at all** on the shared
  pooler endpoint is unverified. If it does not, the RLS design needs the
  session pooler or a direct connection for the web app, which has its own
  connection-limit consequences. This is a stop-and-report condition, not
  something to work around silently.
- **`SET LOCAL` / `set_config(..., true)` under transaction pooling** is
  expected to be safe — the setting is transaction-scoped and Supavisor keeps a
  transaction on one backend — and every client already runs `prepare: false`,
  `max: 1`. Expected to hold; still unproven against the real pooler.

### Known documentation gaps to fix during Part 2

Not yet fixed. Each is a place where `docs/quickstart.md` is stale relative to
the remediation, and each must be fixed **in the same commit** as the step that
needed it, then logged in `DEPLOYMENT_REPORT.md`.

- Step 1 (Supabase) says `pnpm db:bootstrap` migrates and verifies, but never
  tells you to create the application role (`APP_DB_PASSWORD=… pnpm db:app-role`)
  or to set `APP_DATABASE_URL`. Without the latter, bootstrap now **fails**
  with `rls_not_proven` — correctly, but the documented happy path does not
  produce a passing run.
- Step 2 (Vercel) lists four environment variables and omits `APP_DATABASE_URL`
  entirely, so a deployment following the docs would run the web app on the
  admin connection — the configuration the audit found inert.
- Step 5 lists `backfill.yml` as "manual". It now also runs a **nightly
  reconciliation** at `20 7 * * *`.
- Nothing documents that `NEXT_PUBLIC_*` must be present at **build** time for
  the browser bundle. Partially addressed for Docker in this checkpoint's
  parent commits; the Vercel section still does not mention it.

---

## Environment / CLI install state

| Tool                            | State                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vercel`                        | **58.7.0**, installed globally via npm → `C:\Users\HP\AppData\Roaming\npm\vercel.ps1`. **Not logged in.**                                                                      |
| `gh`                            | **2.97.0**, installed via `winget install GitHub.cli` → `C:\Program Files\GitHub CLI\gh.exe`. **Not logged in.** Needs a fresh shell to be on `PATH`, or invoke by full path.  |
| `wrangler`                      | **^4.20.0**, a devDependency of `ingestion/edgar-worker`; already in `node_modules/.bin`. Run as `pnpm --filter @insiderflow/edgar-worker exec wrangler …`. **Not logged in.** |
| `docker`, `node`, `pnpm`, `git` | present                                                                                                                                                                        |
| `psql`                          | **not** installed on the host. Local SQL runs via `docker exec insiderflow-postgres psql …`, which is what `apps/web/e2e/fixtures.ts` does.                                    |

**Databases**

- **Local:** Docker Postgres, host port **5433** (`docker compose up`).
  Admin `postgres/postgres`; the web container connects as `insiderflow_app`
  via `APP_DATABASE_URL` so RLS applies.
- **Production:** Supabase, **transaction pooler, port 6543**, `prepare: false`,
  `max: 1`. Not yet contacted by this project.

**Local env files** (all gitignored, none committed, values never printed):
`apps/web/.env.local`, `ingestion/edgar-worker/.dev.vars`.
`.env.production.local` does **not exist yet** — creating it is blocker #1.

---

## Docs-only discipline

While this checkpoint stands:

- ✅ Allowed: feature work, UI work, security work, tests, refactors — on
  branches, verified locally against the Docker stack.
- ⛔ Not allowed without the user explicitly lifting the pause: `vercel deploy`,
  `wrangler deploy`, `wrangler secret put`, `gh secret set`, any migration or
  bootstrap run against a non-local `DATABASE_URL`, any dashboard change to
  Supabase / Vercel / Cloudflare / GitHub settings, and any interactive login.
- 📝 Required: if a change alters a deployment fact recorded here — an
  environment variable, a required secret, a migration, a cron schedule, a
  documented step — **update this file in the same commit**. A stale checkpoint
  is worse than none, because it is trusted.

---

## BLOCKING before the deployment is public (r15)

Three things no amount of correct code completes. Each is also a visible row
on `/status`, so it cannot be quietly carried to launch: the status page is
read whenever something looks wrong, and a checklist is read once.

| Step                                            | Where it is done                              | State at r15                                               |
| ----------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| **Enable Cloudflare Turnstile**                 | Supabase dashboard → Auth → Attack protection | Code shipped and inert until enabled (r14 item 9)          |
| **Disable the email+password provider in prod** | Supabase dashboard → Auth → Providers → Email | **Not verified.** No process here can read that setting    |
| **Verify RLS against the real Supabase**        | Step 1 of the runbook below                   | Implemented and tested on PGlite; deploy-verification open |

`SECURITY_CHECKLIST.md` item 13 records the password-login risk as "N/A — prod
has no password login". **That statement becomes true when the provider is
actually disabled, and is not true before then.** It is written as N/A on the
strength of an intended configuration, which is exactly the shape of claim r14
was created to stop accepting — so it is repeated here, next to the step that
makes it accurate.

## RESUME — Part 2 runbook

Ordered. Do not skip step 1; it can invalidate later steps.

```
0) Re-read this file end to end.
   git checkout main && git pull
   Confirm CI is green on main:
     gh run list --branch main --limit 3
   Confirm the working tree is clean and no deployment facts here are stale.

1) MEASURE THE BYPASSRLS RISK FIRST — before provisioning anything.
   Once the pooler URL exists (step 2), against production:
     SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'postgres';
   Then prove it rather than trusting the flag: insert a row as admin and
   confirm the ADMIN connection reads it back with no app.user_id set.
   If it cannot, resolve it using the mitigation list above BEFORE deploying —
   and add the admin-direction assertion to packages/db/scripts/bootstrap.mjs.

2) USER: create .env.production.local with the pooler DATABASE_URL (port 6543).
   Generate the application-role password and add it to the same file:
     node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   -> APP_DB_PASSWORD=<generated>

3) USER: three interactive logins.
     vercel login
     pnpm --filter @insiderflow/edgar-worker exec wrangler login
     gh auth login

4) SUPABASE — migrate, create the app role, PROVE enforcement.
     DATABASE_URL=<pooler URL> pnpm db:bootstrap        # migrates + verifies
     DATABASE_URL=<pooler URL> APP_DB_PASSWORD=<pw> pnpm db:app-role
     # Build APP_DATABASE_URL with the pooler's <role>.<project-ref> username
     # form (see "Secondary risks"), then re-run bootstrap so the RLS proof
     # actually runs instead of failing rls_not_proven:
     DATABASE_URL=<pooler> APP_DATABASE_URL=<app pooler URL> pnpm db:bootstrap -- --check
     # REQUIRED PASS: check_ok rls_enforced
     #   "no context -> 0 rows; owner context -> 1 row; other user -> 0 rows"
     # NEVER seed production. Validation uses real EDGAR flow only.

5) VERCEL — link, set env, deploy.
     vercel link
     # Root Directory: apps/web
     # Env (production): DATABASE_URL (admin pooler), APP_DATABASE_URL (app
     #   pooler — NOT in the docs today, see docs gaps), SITE_URL,
     #   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
     #   TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET
     vercel deploy --prod
   Then Supabase → Authentication → URL Configuration: add the production
   origin as Site URL and add <origin>/auth/callback to the redirect
   allow-list, KEEPING the localhost entries for development.
   GitHub OAuth: docs recommend a separate production OAuth app; the Supabase
   callback URL is unchanged. Print the exact steps and wait for the user.

6) CLOUDFLARE — worker, secrets, crons.
     cd ingestion/edgar-worker
     pnpm exec wrangler secret put DATABASE_URL        # admin pooler URL
     pnpm exec wrangler secret put EDGAR_USER_AGENT
     pnpm exec wrangler secret put SITE_URL
     pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN  # the ROTATED token
     pnpm exec wrangler deploy
   Confirm both crons are live ("* * * * *" and "0 * * * *") and within the
   free tier's 5. Observe a real scheduled run:
     pnpm exec wrangler tail

7) GITHUB ACTIONS — secrets, then the reconciliation dry run.
     gh secret set DATABASE_URL      # admin pooler URL
     gh secret set EDGAR_USER_AGENT
     gh secret set TELEGRAM_BOT_TOKEN
     gh secret set OPS_TELEGRAM_CHAT_ID
     gh secret set SITE_URL
   Schedules are already on the default branch, so they arm themselves once
   the secrets exist. Trigger reconciliation once by hand against production:
     gh workflow run backfill.yml
   It must complete and report ZERO accession numbers missed by the live path.

8) SMOKE-TEST PRODUCTION.
   - /api/health and /status: ingestion lag sane, backlog depth visible,
     per-source status honest (politician source correctly reported dead,
     India correctly absent).
   - ALERTS: verify the scanner reads > 0 rules — this is the BYPASSRLS risk
     landing or not landing. The first scan after creating a rule must NOT
     replay history (freshness guard), and must be visible in worker logs.
   - SSE connection ceiling active; rate limits at documented values with
     curl header evidence; trades carry s-maxage, HTML is no-store.
   - AUTH on the production domain, in a browser: sign in with GitHub, confirm
     the callback resolves correctly behind Vercel's proxy (the bd4f316 bug
     class — redirects previously pointed at the bound address), watchlist add
     persists across reload, sign-out restores the signed-out contract.

9) WRITE DEPLOYMENT_REPORT.md.
   Production URLs; evidence (command + output) for every check in step 8; the
   docs-gaps list with the commit that fixed each; a secrets inventory BY NAME
   AND LOCATION ONLY, never values; and a plain "still unverified" section
   (per-row sizing remains an ESTIMATE until real volume; burst behaviour
   remains simulation-proven).
   Then delete the DO-NOT-DEPLOY banner at the top of this file and point it
   at the report.
```

---

## Reference

| Thing                                                                 | Where                                       |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Audit findings + remediation + isolation closeout                     | `AUDIT.md`                                  |
| Deployment procedure (the doc of record; has known gaps listed above) | `docs/quickstart.md`                        |
| Secrets, rotation, what is and is not a secret                        | `docs/security.md`                          |
| Supabase Auth, RLS design, dev/prod split                             | `docs/auth.md`                              |
| RLS migration                                                         | `packages/db/drizzle/0009_rls_enforced.sql` |
| Enforcement proof script                                              | `packages/db/scripts/bootstrap.mjs`         |
| Application-role provisioning                                         | `packages/db/scripts/app-role.mjs`          |
| Cross-user isolation suite                                            | `apps/web/e2e/auth-isolation.spec.ts`       |
| Worker crons + secret list                                            | `ingestion/edgar-worker/wrangler.jsonc`     |

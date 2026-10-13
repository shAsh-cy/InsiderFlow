# Production readiness

One row per claim. Each row names the **command** that establishes it and
quotes **what that command actually printed** on 2026-08-19, on branch
`feat/r20-production-readiness`.

Rows with no command are marked **UNVERIFIED** and say what would verify them.
That is the point of the file: a checklist whose rows are assertions is a
checklist that has never been wrong, and this project has shipped three of
those. r12 recorded the security headers as "already in place" — a check of
the running build found Content-Security-Policy and nothing else. r16 read a
desktop Lighthouse figure as a mobile one and announced a regression that did
not exist. r20 found `db_admin_fallback` in a production build log, meaning
row-level security had never been enforced anywhere, on any database, since
the policies were written.

> **This is not a deployment report.** Nothing here has been deployed. Every
> figure comes from a local production build, the CI configuration, or a live
> call to a third party. The [last section](#what-is-not-verified) lists what
> only a deployment can settle.

---

## Re-run all of it

```bash
pnpm typecheck && pnpm lint && pnpm lint:scripts && pnpm format:check
pnpm lint:changelog && pnpm lint:changelog-quotes
pnpm lint:e2e-locators && pnpm lint:e2e-assertions && pnpm lint:api-schemas
pnpm test                                   # unit + integration
DEPLOY_ENV=ci pnpm build && pnpm lint:client-bundle
pnpm test:e2e                               # includes the 32 axe scans
pnpm lighthouse
pnpm db:app-role && pnpm db:bootstrap -- $(echo --check)
pnpm audit --prod --audit-level=low && pnpm audit --audit-level=low
osv-scanner scan source --lockfile=pnpm-lock.yaml
gitleaks git . --config .gitleaks.toml --redact --exit-code 2
```

On Windows, `scripts/verify-windows.ps1` runs the network probes; see
[docs/verify-windows.md](docs/verify-windows.md) for why `curl` and
`Invoke-RestMethod` cannot be used for them.

---

## Static gates

| Claim                                                | Command                      | Output                                                                                           | Verdict |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| Types check across all 7 packages                    | `pnpm typecheck`             | `apps/web … Done`, and the same for core, db, alerts, analytics, edgar-worker, india-local       | ✅ PASS |
| Lint clean, app + packages                           | `pnpm lint`                  | no output (eslint is silent on success)                                                          | ✅ PASS |
| Lint clean, gate scripts (root, skipped by `-r`)     | `pnpm lint:scripts`          | no output                                                                                        | ✅ PASS |
| Formatting                                           | `pnpm format:check`          | `All matched files use Prettier code style!`                                                     | ✅ PASS |
| Changelog structure, and every claimed commit real   | `pnpm lint:changelog`        | `22 sections (r20 … r1), 126 commits verified`                                                   | ✅ PASS |
| Reconstructed sections quote commits verbatim        | `pnpm lint:changelog-quotes` | `157 fragments across 9 reconstructed sections, all verbatim`                                    | ✅ PASS |
| No class/id selectors in e2e                         | `pnpm lint:e2e-locators`     | `39 spec files, 0 class/id selectors outside 2 allowances`                                       | ✅ PASS |
| No multi-status assertion that accepts a failure     | `pnpm lint:e2e-assertions`   | `39 spec files, 1 justified status array`                                                        | ✅ PASS |
| Every API handler Zod-parses its input               | `pnpm lint:api-schemas`      | `14 narrow every value they read through Zod`, `5 read no … input`, `8 … justified in ALLOWLIST` | ✅ PASS |
| No secrets, and no source maps, in the client bundle | `pnpm lint:client-bundle`    | `94 client assets scanned, 7 key shapes + JWT role claims, 0 source maps, no secrets found`      | ✅ PASS |

`lint:e2e-assertions` earned its place again this round: it rejected an
assertion **written for this document's evidence** — `expect([200, 503])` on
`/api/health`, which accepts the failure state and therefore cannot fail.

---

## Tests

| Claim                               | Command                             | Output                                                                         | Verdict       |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ | ------------- |
| Unit + integration suite            | `pnpm test`                         | **705 passed**, 53 files, across 7 packages (269 / 297 / 75 / 31 / 18 / 8 / 7) | ✅ PASS       |
| End-to-end suite, 4 projects        | `pnpm test:e2e`                     | **343 passed, 20 skipped**, exit 0 — see [E2E](#e2e) below                     | ✅ PASS       |
| Accessibility, 15 routes × 2 themes | `pnpm test:e2e` (part of the suite) | **32 passed**, including `/login` in both themes for the first time            | ✅ PASS       |
| Lighthouse                          | `pnpm lighthouse`                   | **NOT MEASURABLE on this machine** — see [Lighthouse](#lighthouse)             | ⚠️ UNVERIFIED |

705 is up from 653 at the start of the round: 52 tests added, none removed and
none weakened. The additions are 27 for the RLS build/boot gate, 8 for the
`/api/me/*` serializers, 13 for error redaction, and 4 for the build-output
flags.

### E2E

`pnpm test:e2e` builds a production bundle and runs 4 Playwright projects
(chromium, mobile, serial `stream`, `perf`) at 4 workers locally and 2 in CI.
**363 tests, exit 0.**

- **Passing:** 343, including the `perf` project's three 60fps assertions.
- **Skipped:** 20 — the auth-isolation and Telegram-webhook specs, which need
  credentials this machine does not carry. They skip with a printed reason.
  **A skip is an uncovered case, not a green one.**
- **Expected failure:** 1, logged as `x 301 … stream-resume.spec.ts:415 … a
resume cursor at an already-consumed position returns no duplicates`. That is
  the `test.fail()` pin, still failing for the documented reason. See
  [the pins](#the-two-pins).

The total is up from 354: 9 tests added this round to `api-envelope.spec.ts`
(the forbidden-key scan went from 6 endpoints to 11, and gained the
`/api/health` and signed-out `/api/me` cases) and `security-headers.spec.ts`
(the `X-Powered-By` and source-map checks).

### Lighthouse

**This gate did not produce a comparable measurement, and it says so itself.**

`pnpm lighthouse` refuses to run above 15% CPU busy — a control r19 added after
a loaded box reported all five routes below floor at once. This machine sat at
**32–46% busy** throughout, from the developer's own Chrome (30 processes),
editor and Docker Desktop. Closing those is not something this round did.

Run with `--allow-busy`, which stamps the output as not comparable:

```
NOTE — machine 41% busy before the run; scores below are depressed by
       roughly that much and are not comparable

/                perf  63 [63 63 66]  a11y 100 [100 100 100]
/trades          perf  81 [72 84 81]  a11y 100 [100 100 100]
/screener        perf  82 [81 82 83]  a11y 100 [100 100 100]
/stock/ZZNOVA    perf  70 [72 62 70]  a11y 100 [100 100 100]
/design          perf  64 [62 65 70 44 59 59 64 67 69]  a11y 100 […]

STANDING DEFICIT — 5 below the stated goal:
  /screener        performance     82 / 90
```

Three medians fell below their floors — `/` 63 < 72, `/trades` 81 < 82,
`/design` 64 < 66 — which is the r19 pattern exactly and is attributed to the
contention the tool already flagged. **No floor was raised**, and nothing was
changed to make this pass. Accessibility read **100 on every route**, which
contention does not affect.

`/screener` reproduced its documented **82** (samples 81, 82, 83) against a
goal of 90 and a floor of 78 — the standing deficit this project prints on
every run.

A second finding, fixed here: with nothing listening on the base URL, every
run errored, every score came back **0**, and the gate printed ten floor
violations and a standing deficit of ten. A missing server and a catastrophic
regression looked identical. The runner now pre-flights the base URL and aborts
with its own name, the same way it already did for a busy machine.

The 32 axe scans in that total now include `/login`. They did not before, and
nobody had noticed: with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set — the production
configuration — the Turnstile widget holds a `blob:https://challenges.cloudflare.com/…`
request open forever, `networkidle` never fires, and both `/login` scans died
on a 30-second `page.goto` timeout. CI has no site key, so CI never saw it: the
one route with bot protection was the one route the accessibility bar could not
measure. The scan now aborts requests to the challenge host, which changes no
coverage — axe cannot read inside a cross-origin iframe either way — and makes
the gate apply to the configuration that ships.

---

## Row-level security

The finding that started this round. `getDb()` fell back to the admin
`DATABASE_URL` with one warning, and the `insiderflow_app` role had never been
created on any database, including the local one — so the `FORCE ROW LEVEL
SECURITY` policies written in r9 had never applied to anything.

| Claim                                                  | Command                                                                        | Output                                                                                                                                                       | Verdict |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| The application role exists and cannot bypass RLS      | `pnpm db:app-role`                                                             | `{"event":"app_role_ok","role":"insiderflow_app"}` — the script exits 1 if the role ends up `SUPERUSER`/`BYPASSRLS`                                          | ✅ PASS |
| RLS is **enforced**, not merely enabled                | `APP_DATABASE_URL=… pnpm db:bootstrap -- --check`                              | `{"event":"check_ok","check":"rls_enforced","proof":"no context → 0 rows; owner context → 1 row; other user → 0 rows","app_role":"insiderflow_app"}`, exit 0 | ✅ PASS |
| The proof fails loudly when it cannot be made          | same, with `APP_DATABASE_URL` unset                                            | `{"event":"check_failed","check":"rls_not_proven",…}`, exit **1**                                                                                            | ✅ PASS |
| A production **build** without the app role is refused | `DEPLOY_ENV=production pnpm --filter @insiderflow/web build`                   | `BUILD REFUSED: APP_DATABASE_URL is not set…`, exit **1**                                                                                                    | ✅ PASS |
| An undeclared production build is refused too          | `pnpm --filter @insiderflow/web build` (NODE_ENV=production, nothing declared) | `stance_from: NODE_ENV=production`, `BUILD REFUSED`, exit **1**                                                                                              | ✅ PASS |
| A development build still only warns                   | `db-env.test.ts`                                                               | 27 tests over the whole matrix, both branches                                                                                                                | ✅ PASS |
| The proof runs in CI, not just on request              | `.github/workflows/ci.yml`                                                     | e2e job creates the role and runs `--check` between seed and suite                                                                                           | ✅ PASS |
| The e2e suite exercises the RLS-bound role             | `.github/workflows/ci.yml`                                                     | `APP_DATABASE_URL` set at job level; Playwright's server inherits it                                                                                         | ✅ PASS |

**What each half proves, and does not.** The build gate reads environment
variables: it establishes that a distinct application connection was
configured, and catches two ways one can be configured and still inert
(`APP_DATABASE_URL === DATABASE_URL`, and a username that ships with
`BYPASSRLS`). It cannot prove the role at the far end lacks `BYPASSRLS`,
because that needs a connection. `db:bootstrap -- --check` is the half that
connects. Two claims, two rows.

---

## Leak audit

| Claim                                                          | Command                                           | Output                                                                                                                                                                                                                                              | Verdict                 |
| -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| No secrets in what browsers download                           | `pnpm lint:client-bundle`                         | 94 assets, 0 findings                                                                                                                                                                                                                               | ✅ PASS                 |
| No `service_role` string in the client bundle                  | grep over `.next/static`                          | 0                                                                                                                                                                                                                                                   | ✅ PASS                 |
| No `SUPABASE_SERVICE`, no private-key block, no `DATABASE_URL` | grep over `.next/static`                          | 0 each                                                                                                                                                                                                                                              | ✅ PASS                 |
| `sb_secret_` occurrence is not key material                    | grep + read the context                           | 1 hit: `e.startsWith("sb_publishable_")\|\|e.startsWith("sb_secret_")` — `@supabase/supabase-js`'s own classifier. The gate requires 20+ chars of key material after the prefix, which is why it does not fire                                      | ✅ PASS                 |
| No source maps in the browser-served tree                      | `Get-ChildItem .next/static -Filter *.map`        | **0**. Two `.map` files exist under `.next/server` (edge runtime); that tree is never served                                                                                                                                                        | ✅ PASS                 |
| `productionBrowserSourceMaps` is not on by default             | `next.config.ts`                                  | `process.env.ANALYZE === "1"`                                                                                                                                                                                                                       | ✅ PASS                 |
| No `.map` is reachable over HTTP                               | `e2e/security-headers.spec.ts`                    | asks the server for `<chunk>.js.map`, requires 404                                                                                                                                                                                                  | ✅ PASS                 |
| `poweredByHeader` is off                                       | `next.config.ts` + live response                  | **was NOT set** — every response carried `X-Powered-By: Next.js`. Now `poweredByHeader: false`, and the header is absent on `/`, `/trades` and `/api/health`                                                                                        | ✅ **FIXED THIS ROUND** |
| No credential in git history                                   | `gitleaks git . --config .gitleaks.toml --redact` | `145 commits scanned`, `no leaks found`, exit 0                                                                                                                                                                                                     | ✅ PASS                 |
| No credential in tracked files                                 | `git ls-files \| grep .env`                       | `.env.example` only                                                                                                                                                                                                                                 | ✅ PASS                 |
| Working-tree scan                                              | `gitleaks dir .`                                  | **4 findings, all four in `apps/web/.env.local`** — `git check-ignore -v` reports `.gitignore:19:.env.*`, `git ls-files` reports it untracked. That file is where local secrets belong; it is excluded from git and, verified below, from the image | ✅ PASS (with note)     |
| Every `NEXT_PUBLIC_*` is genuinely public                      | repo-wide sweep                                   | 4 variables, each with a verdict — see [docs/security.md](docs/security.md#on-next_public_)                                                                                                                                                         | ✅ PASS                 |

### `NEXT_PUBLIC_*`, in full

| Variable                         | Verdict             | Why                                                                                                                                                                            |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`       | 🟢 Public           | The origin the browser posts sign-ins to; it is in every visitor's network tab and cannot be secret and be usable.                                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | 🟢 Public by design | Identifies the project to the Auth service, carries no authority beyond an anonymous caller's. RLS is what protects the data behind it — which is why the round above matters. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 🟢 Public by design | Rendered into the widget's markup; a challenge cannot work without it. **The secret half is in no environment this app reads** — it is a field in the Supabase dashboard.      |
| `NEXT_PUBLIC_SITE_URL`           | 🟢 Public           | Read once, in `packages/alerts/scripts/send-live-alert.mjs`, with a hard-coded fallback. Nothing on the request path reads it.                                                 |

---

## API and error surface

| Claim                                                                               | Command                                     | Output                                                                                                                                                                              | Verdict                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Public API JSON carries no `user_id`, `dedup_key`, raw XML URL, or cursor internals | `e2e/api-envelope.spec.ts`                  | 9 endpoints × 17 forbidden keys at any depth                                                                                                                                        | ✅ PASS                 |
| `/api/me/*` JSON carries no `userId`                                                | `src/lib/api/me-serializers.test.ts`        | **was leaking it** on `/api/me/watchlist` and `/api/me/alert-rules`. Now allowlisted, and the allowlist is checked against `getTableColumns()` so a new column fails the test       | ✅ **FIXED THIS ROUND** |
| Error bodies carry no stack, SQL, path or driver message                            | `src/lib/api/error-redaction.test.ts` + e2e | 500/400/404 envelopes pinned; 4 error URLs scanned in e2e for 8 markers                                                                                                             | ✅ PASS                 |
| `/api/health` 503 carries no driver message                                         | `src/lib/api/error-redaction.test.ts`       | **was returning postgres.js's message verbatim** — role name, pooler host, region, internal address. Now one of four compile-time constants, with no path from input text to output | ✅ **FIXED THIS ROUND** |

---

## Headers, transport and bot protection

Measured with `scripts/verify-windows.ps1` against a production build of this
commit. **15 probes, all passing, exit 0.**

| Claim                                                                                                         | Output                                                                                                                               | Verdict         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| HSTS, 2 years, subdomains                                                                                     | `max-age=63072000; includeSubDomains` on `/` and `/api/health`                                                                       | ✅ PASS         |
| `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-DNS-Prefetch-Control`, `Cross-Origin-Opener-Policy` | present and exact on both a document and a JSON API                                                                                  | ✅ PASS         |
| CSP with a per-request nonce                                                                                  | `script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`                                                             | ✅ PASS         |
| No `X-Powered-By`                                                                                             | absent on `/`, `/trades`, `/api/health`                                                                                              | ✅ PASS         |
| RFC 9116 `security.txt`                                                                                       | 200, `Expires: 2027-08-01`, `Contact: mailto:security@insiderflow.dev`                                                               | ✅ PASS         |
| Turnstile is enforced on sign-up                                                                              | `POST /auth/v1/signup` with no token → **400** `captcha_failed`, `"captcha protection: request disallowed (no captcha_token found)"` | ✅ **VERIFIED** |
| Turnstile is enforced on magic links                                                                          | `POST /auth/v1/otp` with no token → **400**, same body                                                                               | ✅ **VERIFIED** |
| Turnstile `siteverify` reachable and reading tokens                                                           | 200, `success: true` with Cloudflare's always-passes test secret                                                                     | ✅ PASS         |

Both Auth endpoints are probed. Only `/otp` had been confirmed before; the
sign-up half was assumed, and enabling the captcha in the dashboard covers the
whole Auth surface, so checking one and inferring the other is precisely the
habit that produced the three failures named at the top of this file.

`siteverify` answers **200 for a rejected token as well as an accepted one**,
so the probe reads the `success` field. A check written as
`if (status === 200)` would pass on every possible input.

---

## Supply chain

| Claim                                    | Command                                                    | Output                                              | Verdict |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ------- |
| No known vulnerability in any dependency | `osv-scanner v2.5.0 scan source --lockfile=pnpm-lock.yaml` | `Scanned … 850 packages`, `No issues found`, exit 0 | ✅ PASS |
| Production dependencies clean            | `pnpm audit --prod`                                        | `No known vulnerabilities found`                    | ✅ PASS |
| All dependencies clean, dev included     | `pnpm audit`                                               | `No known vulnerabilities found`                    | ✅ PASS |

The osv-scanner binary was checksum-verified against the release's own
`osv-scanner_SHA256SUMS` before being run —
`4342285bd8be36b9f113468f3eea86e7900befbcd19ca8dc6ac4f0f6cbe7c362`. A
supply-chain check that pulls an unpinned binary over the network and runs it
is not in a position to lecture anyone about dependencies.

---

## Container image

`docker build --target web -t insiderflow-web:r20audit .`, with decoy secret
files planted at `.env` and `ingestion/edgar-worker/.dev.vars` first, exactly
as `ci.yml` does.

| Claim                                                | Command (inside the image)                                                          | Output                                                                                                                                                                                                     | Verdict                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| No `.env` / `.env.*` / `.dev.vars` anywhere          | `find / -name ".env" -o -name ".env.*" ! -name ".env.example" -o -name ".dev.vars"` | _(empty)_                                                                                                                                                                                                  | ✅ PASS                 |
| No `.git`                                            | `find / -name ".git" -maxdepth 6`                                                   | _(empty)_                                                                                                                                                                                                  | ✅ PASS                 |
| The planted decoy value is nowhere on the filesystem | `grep -rl "r20-decoy-must-not-ship" /app`                                           | _(empty)_                                                                                                                                                                                                  | ✅ PASS                 |
| Agent tooling excluded                               | `ls -a /app`                                                                        | **`.claude` was present** before this round, and `skills-lock.json` with it. Both are untracked, so `COPY . .` was picking up whatever happened to be in the developer's directory. Now in `.dockerignore` | ✅ **FIXED THIS ROUND** |

The `.claude` finding is the same class as the `.env.local` leak this
`.dockerignore` already documents, arriving from the other side: there a
pattern was too narrow to exclude a secret, here a directory nobody had
thought of was never named. The build context is a working directory, not a
checkout, and untracked paths are the ones with no reviewer.

---

## The two pins

Both were carried into this round as known and deliberate. **Neither was
weakened, and no test was deleted or relaxed to make anything pass.**

| Pin                         | State after r20                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSE cursor microseconds** | **Still failing, for the documented reason.** `e2e/stream-resume.spec.ts` carries `test.fail()`: the cursor is floored to a millisecond while `created_at` keeps microseconds, so the tail row re-qualifies on every 2.5s poll. The web client dedupes by trade id; a `?mode=poll` consumer gets the tail repeatedly. The fix belongs in `fetchSince`. Untouched this round. |
| **RLS proof**               | **CLOSED.** It was listed as a pin because enforcement could not be proven. It is now proven — `check_ok: rls_enforced` against a live database — and the proof runs in CI on every pull request.                                                                                                                                                                            |

---

## Where we are behind

Unchanged by this round, and stated here rather than left to be discovered.

- **`/screener` Lighthouse.** Mobile medians **82–84** against a goal of 90
  (this round measured 82 on a contended machine). Floored at 78 so a return
  to the r17 figure fails. `pnpm lighthouse` prints the deficit between goal
  and measurement on every run. Two shifts remain named and undiagnosed in
  [docs/performance.md](docs/performance.md), along with `/stock` and
  `/design`.
- **No Lighthouse run on a quiet machine this round.** The gate's own
  pre-flight refused, and the override's numbers are marked not comparable.
  That is an unverified row, not a passing one.
- **Detection latency has never been measured.** `pnpm measure:edgar-latency`
  exits 2 rather than print a number nobody produced.
- **The politicians table is empty.** The pipeline works; its upstream S3
  buckets answer 403.
- **India is self-host only**, off by default, on licence grounds.
- **20 e2e tests skip** for want of credentials. That is 20 uncovered cases.
- **The Supabase email+password provider is still enabled** on the dev
  project, because the cross-user exploitation suite needs to mint users. It
  must be off in production, and `SECURITY_CHECKLIST.md` item 13 only becomes
  true once it is.
- The full "behind the competition" list is in
  [README.md](README.md#where-insiderflow-is-behind): no options flow, no dark
  pool, no multi-country coverage, no five-year insider ranking, no 13D/G.

---

## What is NOT verified

<a id="what-is-not-verified"></a>

Everything above is a local build, the CI configuration, or a live call to a
third party. These need a deployment, and saying so is the whole reason this
file has a last section.

| Claim                                            | Why it is not verified                                                                                                           | What would verify it                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| RLS holds through Supabase's transaction pooler  | `SET LOCAL` semantics on port 6543 are not the same question as PGlite or a direct connection, and this has never been run there | `pnpm db:bootstrap -- --check` against the pooler URL         |
| The hosted role's attributes                     | Supabase's `postgres` role is not a plain superuser and its grants are theirs, not ours                                          | the same command; it reads `rolsuper`/`rolbypassrls` directly |
| Headers survive Vercel's edge                    | measured against `next start`, not against the CDN in front of it                                                                | `scripts/verify-windows.ps1 -BaseUrl https://<deployment>`    |
| Edge caching behaves as documented               | `x-vercel-cache: HIT` cannot exist locally                                                                                       | the curl block in [docs/quickstart.md](docs/quickstart.md)    |
| Email+password provider disabled                 | a Supabase dashboard setting this process cannot read                                                                            | the dashboard, then `/status` stops reporting it `unknown`    |
| Migrations run over the session pooler           | documented from an operational finding (6543 hangs on DDL, the direct host is IPv6-only), not re-run this round                  | `pnpm db:bootstrap` against the 5432 pooler host              |
| Uptime, real-world latency, anything with an SLA | there is no deployment, and this project asserts no SLA anywhere                                                                 | running it                                                    |

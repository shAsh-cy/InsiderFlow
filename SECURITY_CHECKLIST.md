# Security checklist

Every line below is **Control → Proof**. The proof is a command you can run, a
test that fails when the control is removed, or a dashboard setting somebody has
to click — never a claim on its own.

Three things this file tries hard not to do:

- **Mark something done because it was discussed.** Going into r14, HSTS,
  `nosniff`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` were
  all recorded as in place. A `curl` against the running production build
  returned `Content-Security-Policy` and nothing else. They are here now because
  that check was run, not because the list said so.
- **Call something N/A without a guard.** "No file uploads" is true today and
  stops being true the moment somebody adds a CSV import. Each N/A below names
  the test that fails if the assumption changes.
- **Confuse "implemented" with "verified in production".** Deployment is paused;
  there is no Supabase project. Anything that can only be proved against real
  infrastructure says so, and is cross-referenced into
  [DEPLOYMENT_STATE.md](DEPLOYMENT_STATE.md)'s resume runbook.

Run everything at once:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && \
  pnpm lint:changelog && pnpm lint:e2e-locators && pnpm lint:e2e-assertions && \
  pnpm lint:api-schemas && pnpm lint:client-bundle && pnpm format:check
```

---

## The twenty

| #   | Item                        | Status                                                                   | Control                                                                                                                                                | Proof                                                                                                            |
| --- | --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1   | HTTPS everywhere            | **Enforced**                                                             | HSTS 2y + includeSubDomains; SSRF guard refuses non-https upstreams; CSP names no http origin; no plaintext in `.env.example`                          | `vitest run src/lib/security/https-only.test.ts` (7) · `playwright test security-headers` (10)                   |
| 2   | Rotate leaked credentials   | **Done**                                                                 | Telegram bot token **rotated post-exposure** by the user. The history scan did not clear it — it was exposed in chat, outside the repo                 | `gitleaks git . --redact` → 102 commits, no leaks · `SECURITY.md` §History verification                          |
| 3   | Secrets out of the repo     | **Enforced**                                                             | gitleaks CLI (pinned 8.30.1, checksum-verified) over full history + working tree; `.dockerignore` keeps env files out of the image                     | `pnpm dlx` n/a — see `.github/workflows/supply-chain.yml`; image gate in `ci.yml`                                |
| 4   | Secrets out of the client   | **Enforced**                                                             | Bundle audit: key shapes require key material, JWTs decoded and judged by their `role` claim (anon is expected and allowed)                            | `pnpm lint:client-bundle` → 91 assets, 0 findings                                                                |
| 5   | Security headers            | **Enforced** _(was missing)_                                             | HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP, DNS-prefetch off — on `/:path*`, API included                          | `playwright test security-headers.spec.ts` · `curl -sI https://<host>/api/health`                                |
| 6   | Content-Security-Policy     | **Enforced**                                                             | Per-request nonce + `strict-dynamic`; `frame-ancestors 'none'`; `object-src 'none'`; `frame-src 'none'` unless Turnstile                               | `vitest run src/lib/security/csp.test.ts` (28) · `playwright test csp.spec.ts` (6)                               |
| 7   | CSRF on state change        | **Enforced**                                                             | Origin → Referer → refuse, after the 401, on 8 cookie-authenticated mutating handlers                                                                  | `playwright test csrf.spec.ts` (11) · `vitest run src/lib/security/csrf.test.ts`                                 |
| 8   | Input validation            | **Enforced**                                                             | Zod on every handler that reads query, body or path input; gate walks the tree with 37 self-tests                                                      | `pnpm lint:api-schemas` → 19 files, 27 handlers                                                                  |
| 9   | Output encoding / escaping  | **Enforced**                                                             | React escapes JSX; zero `dangerouslySetInnerHTML`; Telegram HTML and both email bodies escape `& < > "` per value                                      | `vitest run src/lib/security/no-raw-html.test.ts` (4) · `packages/alerts` escaping (12)                          |
| 10  | SQL injection               | **Enforced**                                                             | Drizzle parameterises everything; no string-built SQL in the query layer                                                                               | `pnpm lint` (no raw `sql.raw` on user input) · `packages/db` RLS suite                                           |
| 11  | Row-level security          | **Enforced (app)** / **implemented, deploy-verification pending (jobs)** | Policies on `app.user_id`, FORCE RLS, NOBYPASSRLS role. Background jobs now drop to that role per user via `withUserContextAsApp`                      | `vitest run src/rls.test.ts` · `src/scanner-scope.test.ts` (8) — **see runbook**                                 |
| 12  | AuthN provider hardening    | **Enforced** + **1 dashboard step**                                      | Prod = GitHub OAuth + magic link. Email+password is a DEV-project setting and must be off in prod                                                      | `playwright test auth-providers.spec.ts` (3) · `curl .../auth/v1/signup` → 4xx                                   |
| 13  | Password hashing            | **N/A — no passwords**                                                   | With the provider off, this application never receives a credential to hash. GoTrue bcrypts on the dev project                                         | Same three tests as #12: no password field by type, name, autocomplete, or copy                                  |
| 14  | Session management          | **Enforced**                                                             | `getUser()` (server-validated) everywhere; `getSession()` banned by an ESLint rule; sign-out revokes server-side                                       | `pnpm lint` · `playwright test auth-isolation.spec.ts` (12)                                                      |
| 15  | Rate limiting               | **Enforced**                                                             | In-memory + Upstash, anon ~60/min, key 600/min; `/api/stream` caps 4 concurrent SSE per IP                                                             | `playwright test stream-limits.spec.ts` · `vitest run src/lib/api/rate-limit.test.ts` (14)                       |
| 16  | Bot protection              | **Code shipped, NOT enabled**                                            | Turnstile wired end to end and inert without a site key. **Supabase rate limits alone are not the control** — reported inconsistently enforced 2025–26 | `vitest run src/lib/auth/turnstile.test.ts` (9) · enable per docs/auth.md, then `curl .../auth/v1/otp` must fail |
| 17  | File uploads                | **N/A — with a guard**                                                   | No handler accepts multipart/`formData`/File/Blob; no spreadsheet PARSER in the tree (r12 removed SheetJS)                                             | `vitest run src/lib/security/upload-surface.test.ts` (15)                                                        |
| 18  | SSRF on outbound            | **Enforced**                                                             | https-only allowlist, connect-time address pinning via `lookup`, redirects re-judged, IPv4/IPv6 obfuscations covered                                   | `vitest run src/ssrf.test.ts` (112) · `src/ssrf-fetch.test.ts` (33)                                              |
| 19  | Dependency / supply chain   | **Enforced**                                                             | osv-scanner + `pnpm audit` (both scopes) + gitleaks, on PR, push and daily; Next pinned via overrides                                                  | `pnpm audit --prod` · `osv-scanner scan --lockfile=pnpm-lock.yaml` → 755 pkgs, 0                                 |
| 20  | Least-privilege API surface | **Enforced**                                                             | Public `{data,meta}` envelope carries no `user_id`, dedup/occurrence keys, destinations or capability tokens; errors carry no stack, SQL or path       | `playwright test api-envelope.spec.ts` (9)                                                                       |

### The three that are not simply "done"

**#11 — RLS for background jobs.** Implemented and proved locally against the
real migrations; **not** proved against Supabase, because there is no project.
PGlite is Postgres and roles, policies, FORCE and GUCs behave identically, but
the hosted `postgres` role's attributes and the behaviour of `SET LOCAL` through
the **6543 transaction pooler** are Supabase's to confirm. The resume checks are
written into [DEPLOYMENT_STATE.md](DEPLOYMENT_STATE.md) so this cannot be ticked
closed on local evidence.

**#12 — the email+password provider.** Code cannot turn off a dashboard setting.
The tests assert the thing that would change if somebody wired it up — a
password field — because a form appears before a provider gets used.

**#16 — Turnstile.** The code path ships inert. Until the two dashboard steps in
[docs/auth.md](docs/auth.md) are done, **the magic-link form has no bot
protection beyond Supabase's own rate limits**, and those are the control this
project has decided not to rely on alone. That is the largest open risk on this
list.

---

## 2026 additions the twenty omit

| Item                               | Why it matters now                                                                                                       | Proof / how to enable                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GitHub secret scanning**         | Free on public repos. Catches vendors our own rules do not.                                                              | Settings → Code security → Secret scanning **on**                                                                                                      |
| **Push protection**                | The only control that acts on the push. gitleaks tells you a secret is already in history — by then the fix is rotation. | Settings → Code security → Push protection **on**                                                                                                      |
| **Supabase secret detector**       | GitHub's March 2026 partner detector covers `sb_secret_` keys, which is the exact shape #4 greps for.                    | Enabled with secret scanning; no separate switch                                                                                                       |
| **Branch protection on `main`**    | Required checks are what make the gates non-optional.                                                                    | Require: `Typecheck, lint, test, build` · `No secrets in the built image` · `osv-scanner` · `pnpm audit` · `gitleaks`; tick **do not allow bypassing** |
| **Dependabot alerts + updates**    | The scanners say an advisory exists; Dependabot opens the PR that fixes it.                                              | Settings → Code security → Dependabot alerts + security updates                                                                                        |
| **MFA on GitHub**                  | The account that can push to `main` is the account that can ship anything.                                               | GitHub → Settings → Password and authentication                                                                                                        |
| **MFA on Supabase**                | That dashboard holds the service-role key and every auth setting on this list.                                           | Supabase → Account → Security                                                                                                                          |
| **Disable the Data API if unused** | PostgREST exposes tables over HTTP by default. This app talks to Postgres directly.                                      | Supabase → Settings → API → disable, or restrict the exposed schema                                                                                    |
| **JWT expiry**                     | The default hour is long for a token that grants API access.                                                             | Supabase → Authentication → Sessions                                                                                                                   |
| **Leaked-password protection**     | Free, and checks against HaveIBeenPwned. Applies to the DEV project where email+password is on.                          | Supabase → Authentication → Attack Protection                                                                                                          |
| **Actions default permissions**    | Every workflow here declares what it needs; the repo default should not be write.                                        | Settings → Actions → Workflow permissions → read                                                                                                       |
| **`DEPLOYMENT_ACTIVE` unset**      | Keeps the four deployment workflows skipped until there is a deployment, so red means something.                         | `gh variable list` — absent is correct today                                                                                                           |

---

## Post-deploy, once there is a URL

These cannot run against localhost and are not optional:

1. **[securityheaders.com](https://securityheaders.com)** — cross-check #5 and
   #6 against an outside observer. Expect A or A+; anything less means a header
   is being stripped between this app and the browser, which is a hosting
   question rather than a code one.
2. **[SSL Labs](https://www.ssllabs.com/ssltest/)** — TLS configuration is the
   platform's, and it is still yours to check.
3. **`curl -sI https://<host>/api/health`** — the API path is the one most
   likely to lose headers at a proxy, because it is the one the middleware
   matcher never touches.
4. The `/auth/v1/signup` and `/auth/v1/otp` probes in
   [docs/auth.md](docs/auth.md), which prove #12 and #16 from outside the
   dashboard that configured them.

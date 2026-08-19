# Security Policy

InsiderFlow republishes public regulatory filings. It holds no positions,
executes no trades and stores no money — but it does hold accounts, alert
rules and watchlists, and it is a financial-data tool, which makes it a
more interesting target than its balance sheet suggests.

## Reporting a vulnerability

**Email <security@insiderflow.dev>.** Please do not open a public issue
for anything exploitable.

Include what you did, what happened, and what you expected. A request and
response pair, or a short script, is worth more than a description. If you
would like credit in the fix's commit message, say so and how you would
like to be named.

What to expect:

|                                         |                                                  |
| --------------------------------------- | ------------------------------------------------ |
| First response                          | within 3 working days                            |
| Assessment and a plan                   | within 10 working days                           |
| Fix for a confirmed high-severity issue | as fast as we can, and you will be told the date |

This is a small open-source project, not a company with a rota. Those are
honest targets rather than a contractual SLA, and if a date is going to
slip you will hear it from us before it does.

There is no bug bounty. There is no budget for one, and saying so plainly
is better than a page implying otherwise.

**Testing:** please test against your own local instance
(`docker compose up`) rather than a hosted one. Do not run automated
scanners against a deployment you do not own, do not access data that is
not yours, and stop at the point where you have demonstrated the problem.

## Supported versions

`main` is the supported version. This project has no release branches and
backports nothing; fixes land on `main` and self-hosters update by pulling.

## Self-hosting: you own your deployment surface

InsiderFlow is AGPL-3.0 and meant to be self-hosted, and that changes who
is responsible for what.

Some protections that exist on a managed platform do not exist on a VPS.
The clearest example: `x-middleware-subrequest` (CVE-2025-29927) is
stripped at the edge by Vercel and Netlify, which is why the advisory
lists apps hosted there as unaffected. Behind your own nginx, nothing
strips it. This repository therefore rejects that header in middleware
itself — see `apps/web/src/middleware.ts` — so the protection ships in the
source rather than living in somebody else's infrastructure.

Running your own instance, these are yours and nobody else's:

- **TLS.** The application assumes it is behind HTTPS and sets cookies
  accordingly. Terminating TLS is your job.
- **Secrets.** `docs/security.md` lists every environment variable, what
  each one is worth to an attacker, and how to rotate it. `SUPABASE_SERVICE_ROLE_KEY`
  and `TELEGRAM_BOT_TOKEN` are the two that end the game if leaked.
- **The database role.** Run `pnpm db:app-role` and set `APP_DATABASE_URL`.
  Without it the app connects as the admin role and **row-level security
  is not enforced** — the app logs a warning saying exactly this on every
  boot, and it is not decorative.
- **Rate limits.** The in-memory limiter is per-process. Behind more than
  one instance, configure the Upstash Redis backend or the limit is per
  instance rather than per user.
- **Updates.** Advisories are found by the scheduled scan in
  `.github/workflows/supply-chain.yml`, which runs in THIS repository. Your
  fork gets it only if you keep Actions enabled.

## Design decisions worth not undoing

Recorded here because each one looks like an oversight until you know why,
and the natural instinct is to "fix" it.

### The Telegram webhook authenticates by header, never by a secret path

Telegram's `setWebhook` accepts a `secret_token` which it returns on every
update as `X-Telegram-Bot-Api-Secret-Token`. That header is the entire
authentication boundary for `/api/alerts/telegram`, and the path is fixed
and public on purpose.

Do not "improve" this by moving the secret into the URL. A secret in a
path is written to access logs, forwarded in `Referer` headers, recorded
by proxy and CDN telemetry, and kept in browser history. The identical
secret in a header appears in none of those. A secret path looks like
defence in depth and is actually a second, leakier copy of the same
credential.

The comparison is constant-time (`lib/security/constant-time.ts`), and a
missing `TELEGRAM_WEBHOOK_SECRET` closes the endpoint rather than opening
it — the failure mode of a misconfiguration must be "nothing works", never
"everything is permitted". That was a real bug: before r12 the check read
`if (expectedSecret && …)`, so a deployment that had not set the variable
accepted unauthenticated updates and would bind a stranger's alert stream
to whoever asked.

### Authorization is never in middleware

Middleware refreshes a session cookie and does nothing else. Every
protected surface resolves the user itself — `/api/me/*` returns 401 from
inside the route handler, and `/api/*` is outside the middleware matcher
entirely. This is what made CVE-2025-29927 a non-event here, and
`e2e/middleware-bypass.spec.ts` asserts it directly so that moving a
check into middleware fails the suite.

### `getSession()` is banned by lint

`supabase.auth.getSession()` returns whatever is in the cookie without
validating the JWT against the auth server. Deriving a user id from it
means trusting a value the client can edit. `eslint.config.mjs` has a
`no-restricted-syntax` rule that makes it a build error. Use `getUser()`.

## What we scan for, and how often

| Check               | Runs                                | Covers                                                                                                 |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `osv-scanner`       | every PR, push to `main`, and daily | every dependency, dev included, against the OSV aggregate; results upload as SARIF to the Security tab |
| `pnpm audit --prod` | every PR and daily                  | what ships                                                                                             |
| `pnpm audit`        | every PR and daily                  | what a contributor installs                                                                            |
| `gitleaks`          | every PR, push to `main`, and daily | full history AND the working tree, default rules plus project-specific ones                            |
| Image secret gate   | every PR                            | proves no env or secret file is inside the built container, using a planted decoy                      |

### If you ever commit a credential

Rotate it first. Removing the commit does not un-leak anything: the object
stays in the pack, in every clone, and in every fork, and a public repository
is scraped within minutes. Rotation is the fix; rewriting history is cleanup.

`gitleaks` is pinned to an exact version and checksum-verified before it runs,
and it distinguishes "found a secret" (exit 2) from "the scanner failed to
run" (any other nonzero). That distinction matters more than it looks: with
both collapsed into exit 1, a scanner that quietly stopped working reports
exactly like a scanner that is passing.

### History verification, 2026-08-18

Run before this repository was made public, at commit `6154332`:

- `gitleaks git . --redact` — **102 commits scanned, no leaks found**.
- No `.env`, `.env.local` or `.dev.vars` has ever been added in any commit
  on any ref (`git log --all --diff-filter=A`). `.env.example` is tracked on
  purpose and carries local-development defaults only — a localhost Postgres
  URL and a dev password that is meaningless off your own machine.
- No string matching the Telegram bot-token shape
  (`[0-9]{8,10}:AA[A-Za-z0-9_-]{33}`) appears in the tree of any commit,
  checked directly with `git grep` across `git rev-list --all` rather than
  relying on the scanner's own rules.
- The bot id of the token currently in local `.env.local` appears in **zero**
  commits.

That token was nonetheless exposed outside the repository and is being rotated
separately. Nothing above makes rotation optional — the history being clean
says the leak did not happen _here_, not that it did not happen.

## Data honesty is a security property here

This project's invariants about _not inventing data_ are enforced like
security controls, because for a tool people may act on, a fabricated
number is a more likely harm than a stolen session:

- a politician's trade amount is always a range, never a midpoint;
- a value the filing did not disclose renders as "not disclosed", never 0;
- superseded filings are hidden by default;
- synthetic fixtures live in a reserved `ZZ*` namespace and never appear
  in analytics.

Reports that the product states something the filings do not support are
in scope for this policy and are taken as seriously as a technical
vulnerability.

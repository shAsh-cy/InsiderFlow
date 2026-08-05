# Security

How InsiderFlow handles secrets, what to do when one leaks, and what the
project does _not_ consider a secret.

Report a vulnerability privately — open a GitHub security advisory rather than a
public issue.

---

## What is and is not a secret

Treating a public value as a secret is its own failure mode: it makes rotation
drills noisy, and people stop reading the alarm.

| Value                            | Secret?          | Why                                                                  |
| -------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                   | 🔴 **Yes**       | Contains the database password. Full read/write.                     |
| `TELEGRAM_BOT_TOKEN`             | 🔴 **Yes**       | Full control of the bot: read chats, send as it, change the webhook. |
| `TELEGRAM_WEBHOOK_SECRET`        | 🔴 **Yes**       | The only thing authenticating inbound webhook calls.                 |
| `RESEND_API_KEY`                 | 🔴 **Yes**       | Sends email as your domain.                                          |
| `SUPABASE_SERVICE_KEY`           | 🔴 **Yes**       | Bypasses every auth check. Never send it to a browser.               |
| `API_KEYS`                       | 🔴 **Yes**       | Grants the elevated rate-limit tier.                                 |
| `UPSTASH_REDIS_REST_TOKEN`       | 🔴 **Yes**       | Read/write on the rate-limit store.                                  |
| `FINNHUB_API_KEY`, `FMP_API_KEY` | 🟠 Quota-bearing | Not dangerous, but someone else spends your free tier.               |
| `NEXT_PUBLIC_SUPABASE_URL`       | 🟢 **No**        | Public by design.                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | 🟢 **No**        | Public by design.                                                    |
| `TELEGRAM_BOT_USERNAME`          | 🟢 **No**        | It is in the `t.me/` link every user clicks.                         |
| `EDGAR_USER_AGENT`               | 🟢 **No**        | SEC _requires_ it to identify you.                                   |

### On `NEXT_PUBLIC_*`

Anything prefixed `NEXT_PUBLIC_` is **inlined into the JavaScript bundle** at
build time and served to every visitor. This is not a leak — it is the
mechanism. The Supabase anon key in particular is designed to be published: it
identifies the project and carries no authority beyond what row-level security
and the Auth service grant an anonymous caller.

So: if a `NEXT_PUBLIC_*` value appears in an image, a screenshot, or a bundle,
**that is not an incident** and does not require rotation. Rotating it is
disruptive (every client must be rebuilt) and buys nothing.

The one thing that _is_ an incident: a genuine secret accidentally given a
`NEXT_PUBLIC_` prefix. `SUPABASE_SERVICE_KEY` must never be prefixed. If it ever
is, rotate it immediately — it has been served to every visitor since the build.

---

## Where secrets live

Never in the repository. Never in a `docker-compose.yml`. Never in an image.

| Target              | Mechanism                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- |
| Local development   | `apps/web/.env.local`, `.env`, `ingestion/edgar-worker/.dev.vars` — all gitignored |
| Vercel (web)        | Project Settings → Environment Variables                                           |
| Cloudflare (worker) | `wrangler secret put NAME`                                                         |
| GitHub Actions      | Settings → Secrets and variables → Actions                                         |

Verify the ignore rules still hold after touching them:

```bash
git check-ignore -v apps/web/.env.local .env ingestion/edgar-worker/.dev.vars
```

Every path must print a matching rule. No output for a path means it is
committable — stop and fix `.gitignore` before doing anything else.

---

## Build contexts leak differently from commits

A clean `git log` does not mean a clean image. `.gitignore` and `.dockerignore`
**do not share pattern semantics**, and the difference is silent:

| Pattern   | `.gitignore`                         | `.dockerignore`                   |
| --------- | ------------------------------------ | --------------------------------- |
| `.env`    | matches at **every** directory level | matches **only** the context root |
| `**/.env` | (same as above)                      | matches at every level            |

This bit us. `.dockerignore` carried a bare `.env.*`, so `apps/web/.env.local`
was copied into the image — and because Next.js auto-loads `.env.local` at
runtime, the container's behaviour was governed by an untracked developer file
instead of its compose configuration. The observable symptom was an anonymous
rate limit of 600 instead of the documented 60, with nothing in the container's
environment to explain it.

Two consequences worth internalising:

1. **Deleting the file in a later layer does not help.** Image layers are
   additive and individually extractable.
2. **A history scan would not have caught this.** The repository was, and is,
   clean. The leak lived only in the build artefact.

The fix is enforced by CI, not by review: `.github/workflows/ci.yml` has a
required `image-secret-scan` job that plants decoy `.env` files at three depths,
builds the image, and fails if any survives.

```bash
# Run the same check locally
docker build --target web -t insiderflow-web:local .
docker run --rm --entrypoint sh insiderflow-web:local -c \
  'find /app -name ".env" -o -name ".env.*" ! -name ".env.example" -o -name ".dev.vars"'
# Expected: no output
```

> ⚠️ **Never publish an image built before the `image-secret-scan` CI job
> existed** (`git log --diff-filter=A -- .github/workflows/ci.yml` and any build
> predating the `**/`-rooted `.dockerignore` patterns). Those images may contain
> the builder's `.env.local`. If you have pushed one to a registry, delete the
> tag _and_ rotate every credential it held — deleting a tag does not unpublish
> a layer that has already been pulled.

---

## Rotation procedure

Rotate on any of these, without debating whether it was "really" exposed: a
credential appeared in a chat, a commit, a screenshot, a shared terminal, a CI
log, a support ticket, or a container image. Exposure is cheap to assume and
expensive to disprove.

Order matters — issue the new value, deploy it, _then_ revoke the old one, or
you take an outage between steps.

### Telegram bot token

Full control of the bot. Rotate via @BotFather:

1. `/revoke` → select the bot. The old token dies immediately.
2. `/token` → select the bot → copy the new one.
3. `wrangler secret put TELEGRAM_BOT_TOKEN --config ingestion/edgar-worker/wrangler.jsonc`
4. Vercel → Environment Variables → update → redeploy.
5. GitHub → Actions secrets → update.
6. Re-register the webhook (the token is in the URL, so it must be re-set):

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$SITE_URL/api/alerts/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Use a **different bot for production than for development.** A dev token that
has been pasted into a terminal, a log, or an assistant transcript should never
be the one guarding production users' alerts.

### Telegram webhook secret

No third party issues this — generate it yourself:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Set it in Vercel, then re-run `setWebhook` above with the new value. Until both
sides match, inbound webhooks return 403 and Telegram retries; the window is
small and self-healing, but do the two steps back to back.

### Database password

Supabase → Settings → Database → Reset database password. Then update
`DATABASE_URL` in **all four** places — Vercel, `wrangler secret put`, GitHub
Actions secrets, and any local `.env`. Missing one produces a job that fails
authentication on its next scheduled run, which may be a day later.

### Resend / Finnhub / FMP / Upstash

Issue a new key in the provider dashboard, deploy it everywhere, then delete the
old key. All four support having two keys live at once, so there is no outage.

### Supabase anon key

Do not rotate on exposure — see [On `NEXT_PUBLIC_*`](#on-next_public_) above.
Rotate only if you have reason to believe the _project_ is compromised, in which
case rotate the service key and reset the database password too.

---

## Application security posture

### Authentication

Sessions are Supabase Auth; all application data lives in the project's own
Postgres. Server-side identity is always derived from
`supabase.auth.getUser()`, which validates the JWT against the Auth server.
`getSession()` reads unverified cookie claims and is **never** used to authorise
anything — a lint-enforced rule, with a test asserting a forged cookie is
rejected.

Post-login redirects accept **same-origin relative paths only**. Absolute URLs,
protocol-relative `//evil.com` forms, and encoded variants are rejected and fall
back to `/`.

### Authorisation — two independent layers

1. **Query layer (primary).** Every function in
   `apps/web/src/lib/api/user-queries.ts` filters by `userId`, and no route
   accepts a user id from the request body or query string. Identity comes from
   the validated session, never from user input.
2. **Row-level security (defence in depth).** The four user tables have
   `FORCE ROW LEVEL SECURITY` and policies keyed on
   `current_setting('app.user_id', true)`. The application connects as a
   dedicated **non-superuser** role, so the policies actually apply — a
   superuser or table owner would bypass them silently.

`pnpm db:bootstrap` **proves** the second layer rather than asserting it: it
inserts a probe row, then tries to read it back from a connection with no
`app.user_id` set. If the row is visible, RLS is not enforced and bootstrap
reports `rls_not_enforced` loudly. See [docs/auth.md](auth.md).

### Rate limiting

60 requests/minute per IP by default, 600 with an API key. In-memory per
instance unless `UPSTASH_REDIS_REST_URL` is set, in which case the limit is
global. SSE additionally caps concurrent held connections, globally and per IP,
returning 503 with `Retry-After` past the ceiling.

### Unsubscribe and link tokens

192 bits from `node:crypto` `randomBytes(24)`, base64url. Telegram link tokens
are single-use and time-limited.

### Data handling

The project publishes public regulatory filings. It stores no financial
account data, no PII beyond an email address and an optional Telegram chat id,
and no payment details.

---

## Known exposure log

Kept deliberately — a project that never records an incident is not one that
never had one.

| Date       | What                                                                                     | Status                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | Development Telegram bot token visible during setup                                      | Superseded: production uses a separate bot with a token issued after rotation. Rotate the dev token via @BotFather `/revoke`. |
| 2026-08-04 | `apps/web/.env.local` copied into locally built Docker images (`.dockerignore` glob bug) | Fixed; CI gate added. The webhook secret was regenerated. No image was published. Repository history was and remains clean.   |

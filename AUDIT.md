# InsiderFlow — pre-release audit

**Date:** 2026-08-04
**Scope:** open-source public release readiness
**Verdict:** 🔴 **NO-GO** — one BLOCKER, eight MAJOR

---

## ⚠️ Auditor independence — read this first

**This audit was performed by the same agent that wrote the code.** It is not an
independent review, and it should not be presented as one.

The practical limitation: I am least likely to question the assumptions I made
while building. Every finding below is backed by a command and its output, so
the _positive_ findings can be re-run and checked by anyone. But the **absence**
of findings in an area is much weaker evidence than it would be from a reviewer
who had never seen the code — I cannot audit a blind spot I share.

Areas where that matters most, and where an independent pass would add the most:

- **Architecture-level assumptions** (cursor/feed design, lease model) — I chose
  them, so I am poorly placed to notice a wrong framing.
- **Threat modelling** — I tested the attacks I thought of when building.
- **UX/product judgement** — "does this actually deliver the promise" is exactly
  the question an author answers too generously.

Commission a genuinely independent review before public release. Treat this
document as a self-check that found real defects, not as clearance.

---

## Method

Clean-room start: `docker compose down -v && docker compose up`, then verified
against the running system rather than against docs or comments. Adversarial
rows were seeded directly into Postgres to attempt each data-honesty violation.
All evidence below is reproducible.

**Environment contamination discovered mid-audit (see BLOCKER-1):** the running
container loaded an untracked developer env file, so any measurement taken
before that was found may reflect that file rather than the documented
configuration. Affected measurements are flagged and were re-derived from source.

---

## Findings

### 🔴 BLOCKER-1 — Live secrets are baked into the shipped Docker image

`.dockerignore` uses `.env` and `.env.*`, which in Docker match **only at the
context root**. `apps/web/.env.local` is therefore copied into the image, and
Next.js auto-loads `.env.local` at runtime.

**Evidence**

```console
$ docker run --rm --entrypoint sh insiderflow-web:latest -c 'ls -la /app/apps/web/.env*'
-rwxr-xr-x 1 root root 853 Aug  3 12:14 /app/apps/web/.env.local

$ docker run --rm --entrypoint sh insiderflow-web:latest \
    -c 'while IFS="=" read -r k v; do case "$k" in [A-Z]*) echo "$k length=${#v}";; esac; done < /app/apps/web/.env.local'
DATABASE_URL length=55
NEXT_PUBLIC_SUPABASE_URL length=40
NEXT_PUBLIC_SUPABASE_ANON_KEY length=46
TELEGRAM_BOT_TOKEN length=46
TELEGRAM_BOT_USERNAME length=17
TELEGRAM_WEBHOOK_SECRET length=32
RATE_LIMIT_PUBLIC_PER_MIN length=3
```

Seven variables, all non-empty, including a **live Telegram bot token**, a
Supabase anon key, a webhook secret, and a database URL.

`file:line` — [.dockerignore:20-21](.dockerignore#L20-L21) (`.env`, `.env.*` —
missing `**/` prefix, unlike [.dockerignore:23](.dockerignore#L23) `**/.dev.vars`
which _is_ correct).

**Impact**

1. Anyone who builds and publishes this image ships their credentials inside it.
   Image layers are trivially extractable; deleting the file in a later layer
   would not help.
2. **Silent configuration override.** The container's behaviour was governed by
   an untracked developer file rather than `docker-compose.yml`. This is not
   theoretical — it changed observed behaviour during this audit:

```console
$ curl -sI "http://127.0.0.1:3000/api/trades?limit=1" | grep -i x-ratelimit-limit
x-ratelimit-limit: 600          # documented anonymous limit is 60
$ docker inspect insiderflow-web --format '{{range .Config.Env}}{{println .}}{{end}}' | grep RATE_LIMIT
(nothing)                        # not from compose — it came from the leaked file
```

3. It invalidated the cold-start test: the container had auth configured from a
   file a fresh contributor would not have.

**Note on the git history:** the repository itself is clean (see PASS-1). This is
a build-context leak, not a commit leak — which is why a history scan alone
would have missed it.

---

### 🟠 MAJOR-1 — Row-level security is decorative, and is falsely certified

RLS is enabled on all four user tables, but `FORCE ROW LEVEL SECURITY` is not
set and the application connects as a superuser, which bypasses RLS entirely.

**Evidence**

```console
$ docker exec insiderflow-postgres psql -U postgres -d insiderflow -t -A -c "
    select 'rolsuper='||rolsuper||' rolbypassrls='||rolbypassrls from pg_roles where rolname=current_user;
    select relname||' relrowsecurity='||relrowsecurity||' relforcerowsecurity='||relforcerowsecurity
    from pg_class where relname in ('user_watchlists','alert_rules','alert_channels','alerts_log');"
rolsuper=true rolbypassrls=true
user_watchlists  relrowsecurity=true relforcerowsecurity=false
alert_rules      relrowsecurity=true relforcerowsecurity=false
alert_channels   relrowsecurity=true relforcerowsecurity=false
alerts_log       relrowsecurity=true relforcerowsecurity=false
```

This holds in production too: Supabase's pooler connection is also the table
owner, so `relforcerowsecurity=false` means the policies never apply.

**Why it is MAJOR rather than BLOCKER:** query-layer scoping is the documented
_primary_ control, and it verifiably holds — every user-table function filters
by `userId`, no route accepts a user id from the request, and all `/api/me/*`
routes reject anonymous callers:

```console
GET/POST /api/me/watchlist    → 401
GET/POST /api/me/alert-rules  → 401
GET/POST /api/me/channels     → 401
```

The defect is that a **second** layer is claimed and does not exist:

- [packages/db/src/schema.ts:319-323](packages/db/src/schema.ts#L319-L323) —
  "RLS is defense in depth"
- [packages/db/scripts/bootstrap.mjs](packages/db/scripts/bootstrap.mjs) emits
  `{"event":"check_ok","check":"rls"}`, certifying a control that is inert.

A verification that certifies a non-functional control is worse than no
verification, because it stops anyone from looking again.

**Not verified:** actual cross-user access could not be attempted — the Docker
stack has no configured Supabase project, so no session could be forged. The
query-layer conclusion is from code inspection, not exploitation.

---

### 🟠 MAJOR-2 — Telegram digest injects unescaped user and issuer data into HTML

Every Telegram/email path escapes except one. The digest's Telegram fallback
interpolates `ruleName`, `ticker`, and `companyName` raw into a
`parse_mode: "HTML"` payload.

`file:line` — [packages/alerts/src/dispatch.ts](packages/alerts/src/dispatch.ts),
the `No email configured — deliver the digest over Telegram instead` block.
Compare [packages/alerts/src/format.ts:57-60](packages/alerts/src/format.ts#L57-L60),
which escapes correctly.

**Evidence** (temporary probe driving the real `dispatchDigest` on PGlite with a
mock fetch; probe deleted after capture)

Case A — user-controlled rule name:

```
=== PARSE MODE: HTML
📰 <b>InsiderFlow digest</b> — 1 alerts

<b>My <img src=x onerror="alert(1)"> rule</b>
• ZZAUDIT P

INJECTED <img ...> present: true
```

Case B — **no user malice required**, an ordinary EDGAR issuer name on a
tickerless company:

```
• ZZ Procter & Gamble <Holdings> P

UNESCAPED '&' present: true
UNESCAPED '<Holdings>' present: true
```

**Impact.** Telegram's HTML mode accepts only a small tag whitelist and rejects
malformed entities with `400 Bad Request: can't parse entities`. Real issuer
names containing `&` are extremely common (AT&T, Procter & Gamble, Johnson &
Johnson). For an affected user the digest **never sends**, and because a failed
send leaves rows `pending`, it retries and fails indefinitely.

Security impact is secondary (a user injecting HTML into their own chat), but an
`<a href>` in a rule name renders as a live link, which has mild phishing value
if a digest is forwarded.

---

### 🟠 MAJOR-3 — `docker compose up` does not reach the product the docs promise

[docs/quickstart.md](docs/quickstart.md) claims: _"You get a working product
immediately: trades, a screener with all six presets, company and insider pages,
a heatmap, congressional disclosures, and a status page."_

**Evidence**

```console
$ for p in latest big-buys cluster-buys exec-buys dip-buys big-discretionary-sales unusual-flow; do
    curl -s "localhost:3000/api/screener/$p?limit=50" | grep -o '"count":[0-9]*' | head -1
  done
latest                   → 13
big-buys                 →  4
cluster-buys             →  0   ← empty
exec-buys                →  3
dip-buys                 →  6
big-discretionary-sales  →  2
unusual-flow             →  0   ← empty

$ curl -s "localhost:3000/api/leaderboard?limit=50" | grep -c insiderId
0                                                        ← empty

$ docker exec insiderflow-postgres psql ... -c "select count(*) from cluster_flags;   -- 0
                                                select count(*) from insider_scores;  -- 0
                                                select count(*) from company_anomalies; -- 0"
```

`docker-compose.yml` runs migrations and the seed, but never runs the analytics
job, so every derived table is empty. Two of seven presets and the entire
leaderboard render blank on a fresh contributor's first run — which reads as
broken software.

Secondary: the docs say "six presets"; there are **seven**
([schemas.ts SCREENER_PRESETS](apps/web/src/lib/api/schemas.ts)).

---

### 🟠 MAJOR-4 — The cluster preset returns provably wrong results by default

Independent of MAJOR-3: with `cluster_flags` empty, the flags-backed path
returns _zero_ where the query-time definition returns _one_. This is a wrong
answer, not merely a missing feature.

**Evidence**

```console
$ docker exec insiderflow-postgres psql ... -c "
  select string_agg(c.ticker,',') from (
    select company_id from transactions where code='P' and txn_date >= current_date-14
    group by company_id having count(distinct insider_id) >= 2) x
  join companies c on c.id=x.company_id;"
ZZNOVA                                  ← ground truth: 1 company qualifies

$ curl -s "localhost:3000/api/screener/cluster-buys?limit=50" | grep -o '"count":[0-9]*'
"count":0                               ← API says none
```

The documented escape hatch (`INSIDERFLOW_CLUSTER_SOURCE=sql`) is not set in
docker-compose. The existing parity test only asserts the two paths agree _after_
maintenance has run, so it cannot catch this configuration.

---

### 🟠 MAJOR-5 — EDGAR ingestion can permanently miss filings under load

The feed is a rolling window of the 100 most recent filings, fetched once per
run with no paging and no cursor; each run processes at most 25.

`file:line` —
[packages/core/src/edgar.ts:28](packages/core/src/edgar.ts#L28) (`count = 100`),
[pipeline.ts:426](ingestion/edgar-worker/src/pipeline.ts#L426) (`maxFilings ?? 25`),
[wrangler.jsonc:30](ingestion/edgar-worker/wrangler.jsonc#L30) (`MAX_FILINGS_PER_RUN: "25"`),
and `ingestFromFeed` which calls `edgarCurrentFeedUrl(form)` exactly once per form.

**Arithmetic.** Sustained arrival rate _r_ filings/min against a 25/min drain
grows the unprocessed backlog at _r_ − 25. Once the backlog exceeds the 100-item
feed window, the oldest unprocessed filings scroll off and are **never seen
again** — there is no cursor to go back for them.

At _r_ = 50/min the backlog crosses 100 in ~4 minutes. EDGAR Form 4 volume is
heavily clustered after the US market close, so this is a plausible daily
condition, not a pathological one.

**Mitigating:** the daily full-index backfill (`.github/workflows/backfill.yml`)
reads a complete list and would recover the gap — but it is **manual**, and
nothing detects that it is needed (see MAJOR-6).

---

### 🟠 MAJOR-6 — The ingestion backlog is invisible to operators

`ingestFilingRefs` logs `edgar_batch_capped` with a `pending` count when it caps,
but that number reaches no observable surface. `/api/health` and `/status` report
alert-queue depth (`alertsPending`) and **not** ingestion backlog.

**Evidence**

```console
$ grep -nE 'backlog|pending|unprocessed|queue' apps/web/src/lib/api/health.ts
117:  pending: sql`count(*) filter (where ${alertsLog.status} = 'pending')`   ← alerts, not ingestion
220:  alertsPending: ...
```

Consequence: MAJOR-5 is undetectable in production. The observability layer
reports that the cron _ran_, which is exactly the weaker signal the health module's
own docstring warns about ("a heartbeat proves a job ran, not that it worked").

---

### 🟠 MAJOR-7 — The latency claim does not survive a burst

Computed from constants, not docs.

| Segment                  | Source                                             | Worst case |
| ------------------------ | -------------------------------------------------- | ---------- |
| Wait for next cron tick  | `crons: ["* * * * *"]`                             | 60 s       |
| Fetch + parse + persist  | measured `cron_complete durationMs` for 25 filings | ~12 s      |
| Page render              | HTML is `no-store`, always fresh                   | 0 s        |
| `/api/trades` edge cache | `CACHE_POLICIES.trades.sMaxAge = 60`               | +60 s      |
| SSE window               | `WINDOW_MS = 25_000`                               | +25 s      |

**Single filing:** ~72 s to the page, ~2 min via cached API/SSE. The "~1–2 min"
claim **holds**.

**Burst of 200 filings in one minute:** drain is ⌈200 ∕ 25⌉ = **8 cron runs ≈ 8
minutes** before the last is visible — 4–8× the claim, with the tail at risk of
being lost entirely per MAJOR-5. No documentation qualifies the claim for bursts.

---

### 🟠 MAJOR-8 — The shipped seed violates the project's own honesty invariant

[docs/architecture.md:107](docs/architecture.md#L107) states: _"A missing value is
never a zero."_ The seed then writes a stock grant with `price: 0`.

**Evidence**

```console
$ docker exec insiderflow-postgres psql ... -c "select code, relevance, price, value, dedup_key
                                                 from transactions where price = 0 or value = 0;"
A | routine | 0.0000 | 0.0000 | e2e-seed-ZZNOVA-ZZMARLOWREED-20-A#0

$ curl -s localhost:3000/api/rss/latest | grep -o '.\{80\}USD 0.\{30\}'
...acquired 40,000 shares of ZZ Nova Robotics Inc. on 2026-07-15 at USD 0 [routine] via edgar...

$ curl -s localhost:3000/stock/ZZNOVA | grep -o '>\$0<'
>$0<
```

`file:line` — [packages/db/scripts/seed.mjs:136](packages/db/scripts/seed.mjs#L136).

A grant has **no** purchase price; the correct representation is `NULL` →
"not disclosed". The rendering pipeline is correct (it faithfully prints the 0 it
was given) — the **fixture** is dishonest. It is synthetic and namespaced, so it
cannot be mistaken for a real filing, but it is the exemplar every contributor
sees first and it contradicts the headline promise.

---

### 🟡 MINOR

| #       | Finding                                        | Evidence                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MINOR-1 | `.env.example` omits two read variables        | `RATE_LIMIT_APIKEY_PER_MIN` ([rate-limit.ts:93](apps/web/src/lib/api/rate-limit.ts#L93)), `PLAYWRIGHT_BASE_URL`                                                                                                                                                                                        |
| MINOR-2 | Docstring contradicts code                     | [user-queries.ts](apps/web/src/lib/api/user-queries.ts) — "Never add a function here that reads or writes a user table without a user_id predicate"; `completeTelegramLink` has none. It is _correctly_ scoped by a 192-bit single-use capability token, so the code is safe and the comment is wrong. |
| MINOR-3 | SCALING.md per-row byte figures **unverified** | At 15 transaction rows, `pg_total_relation_size/count` = 10,922 B/row — dominated by fixed 8 KB index pages. The "400 B + 250 B" claim is _plausible_ but cannot be confirmed or refuted at this volume. Re-measure at ≥100k rows.                                                                     |
| MINOR-4 | Docs say "six presets"; there are seven        | [quickstart.md](docs/quickstart.md) vs `SCREENER_PRESETS`                                                                                                                                                                                                                                              |
| MINOR-5 | SSE has no concurrent-connection cap           | [stream/route.ts](apps/web/src/app/api/stream/route.ts) rate-limits per IP/minute but nothing bounds simultaneous held connections; each holds a function for 25 s                                                                                                                                     |
| MINOR-6 | Seed ships no India disclosure rows            | `sast_disclosures`, `bulk_block_deals`, `pledge_disclosures` all 0, so the India panels render only their empty states — the feature is unprovable from the seed                                                                                                                                       |

---

## What passed (verified, not assumed)

| #       | Check                                                     | Evidence                                                                                                                                                                                                                                              |
| ------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PASS-1  | **Git history is clean of secrets**                       | 9 commits; no `.env`/`.dev.vars` ever added; no token-shaped high-entropy strings in any tracked blob across all history. `git check-ignore` confirms all three live secret files are ignored and present only as untracked.                          |
| PASS-2  | **PTR amounts are never point values**                    | Attack row (`amount_min=50M, amount_max=NULL, amount_range=NULL`) renders `$50,000,000+` in HTML and RSS; API returns `"amountMax":null`. Verbatim-label rows render `Over $50,000,000`. No surface synthesised a midpoint.                           |
| PASS-3  | **Superseded rows hidden by default, flagged when shown** | Attack row on a superseded filing: default `/api/trades` → 0 hits; `include_superseded=true` → 1 hit carrying `"superseded":true`; absent from RSS and screener.                                                                                      |
| PASS-4  | **No synthetic leakage into aggregates**                  | With `INSIDERFLOW_SHOW_SYNTHETIC=false` (production default) and populated `insider_scores`/`cluster_flags`/`company_anomalies`: heatmap API, leaderboard API, and both HTML pages contain zero `ZZ*` rows; the synthetic notice is correctly absent. |
| PASS-5  | **NULL values render as not-disclosed**                   | Attack row with `price=NULL, value=NULL` → API `"price":null,"value":null`; RSS "undisclosed value".                                                                                                                                                  |
| PASS-6  | **Token entropy**                                         | `randomBytes(24).toString("base64url")` = 192 bits from `node:crypto` ([tokens.ts](apps/web/src/lib/auth/tokens.ts)) — not guessable.                                                                                                                 |
| PASS-7  | **Auth boundary**                                         | All six `/api/me/*` method+route combinations return 401 anonymously; no route reads a user id from the request body or query.                                                                                                                        |
| PASS-8  | **India module isolation**                                | No hosted-path import of `india-local`; not a dependency of `apps/web`, `edgar-worker`, or any package. Only doc-comment references.                                                                                                                  |
| PASS-9  | **Licence coherence**                                     | `LICENSE` = AGPL-3.0; `package.json` = `AGPL-3.0-only`; no GPL-2-only / proprietary / non-commercial dependency licences detected.                                                                                                                    |
| PASS-10 | **i18n**                                                  | `<html lang="en">` → `<html lang="hi">` via cookie; Hindi landing copy renders.                                                                                                                                                                       |
| PASS-11 | **API docs**                                              | `/docs` returns 200; `/api/openapi.json` documents 11 paths.                                                                                                                                                                                          |

---

## Promise coverage matrix

Against the six original promises.

| Promise                                    | Status      | Evidence                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Faster (~1–2 min vs ~15)**            | ⚠️ DEGRADED | Holds for a single filing (~72 s computed). Breaks to ~8 min for a 200-filing burst, with possible permanent loss. MAJOR-5/6/7.                                                                                                                                                       |
| **2. More sources**                        | ⚠️ DEGRADED | EDGAR live; Finnhub/FMP present but key-gated and unexercised here; India adapters present but seed has zero rows; politician pipeline present but **upstream is dead** (403 — documented honestly, ingests nothing).                                                                 |
| **3. Indian-market tracking**              | ⚠️ DEGRADED | Schema, adapters, and stock-page panels exist and render; zero seeded rows means the path is unproven end-to-end from a clean start. MINOR-6.                                                                                                                                         |
| **4. Free-tier deployable + scaling path** | ⚠️ DEGRADED | `docker compose up` works but under-delivers (MAJOR-3/4). Deploy path is documented but was **not executed** in this audit — no Vercel/Supabase/Cloudflare deployment was performed, so it is unverified. SCALING.md's core sizing claim is unverifiable at current volume (MINOR-3). |
| **5. Lightweight, motion-rich dark UI**    | ✅ WORKS    | All 12 routes return 200 from a clean start; treemap, tables, and locale switching render. Not assessed for visual quality or perceived performance.                                                                                                                                  |
| **6. Honest data handling**                | ⚠️ DEGRADED | The four adversarial attacks all **failed to break it** (PASS-2/3/4/5) — the runtime honesty guarantees hold. But the shipped seed violates the project's own stated invariant (MAJOR-8).                                                                                             |

Feature-level:

| Feature                                                                                                                     | Status                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Live feed, screener (5 of 7 presets), stock pages, insider profiles, watchlist, heatmap, RSS, API docs, i18n, status, legal | ✅ WORKS                                                      |
| Screener `cluster-buys`, `unusual-flow`                                                                                     | ❌ BROKEN from clean start (MAJOR-3/4)                        |
| Leaderboard / scoring                                                                                                       | ❌ BROKEN from clean start (empty; MAJOR-3)                   |
| Alerts — instant / freshness / orphan                                                                                       | ✅ WORKS (unit-verified)                                      |
| Alerts — digest over Telegram                                                                                               | ❌ BROKEN for ordinary issuer names (MAJOR-2)                 |
| Politician page                                                                                                             | ✅ WORKS as honest-empty (upstream dead, correctly disclosed) |
| CSV / XLSX export                                                                                                           | ⚠️ NOT TESTED — client-side; not exercised headlessly         |
| India SAST / pledge / bulk panels                                                                                           | ⚠️ NOT PROVEN — render empty, no seed data                    |

---

## Not verified

Stated explicitly rather than left as implied coverage:

- **No production deployment was performed.** Vercel, Supabase, and Cloudflare
  Worker deploys are documented but untested. Free-tier behaviour, edge caching
  in a real CDN, and Supabase pooler behaviour are all unverified.
- **No cross-user access attempt succeeded or failed** — a session could not be
  forged without a configured Supabase project. MAJOR-1's query-layer conclusion
  is from inspection only.
- **Rate-limit enforcement was measured under a contaminated env** (BLOCKER-1)
  and re-derived from source rather than re-measured; 80 sequential requests
  returned 200 against a limit the leaked file had raised to 600.
- **Per-row storage sizing** cannot be validated at 15 rows (MINOR-3).
- **Sustained real EDGAR burst behaviour** is computed from constants, not
  observed under load.

---

## Verdict: 🔴 NO-GO

BLOCKER-1 alone is disqualifying: publishing this repository as-is invites every
downstream builder to bake their own credentials into a distributable image, and
the reference developer's live Telegram bot token is already inside the locally
built one.

The honesty guarantees — the project's central claim — **held under adversarial
testing**, which is the most encouraging result here. The failures are in
packaging, operational visibility, and one unescaped string.

## Shortest path to GO

1. **Fix the build-context leak.** Change `.dockerignore` to `**/.env` and
   `**/.env.*`. Rebuild and assert absence in CI:
   `docker run --rm --entrypoint sh <img> -c '! ls /app/**/.env* 2>/dev/null'`.
   **Rotate all seven leaked credentials** — the Telegram token, the Supabase
   anon key, the webhook secret, and the database password.
2. **Escape the digest summary** in `dispatch.ts` with the existing `escapeHtml`,
   and add a test using an issuer name containing `&` and `<`.
3. **Resolve the RLS claim** — either `ALTER TABLE … FORCE ROW LEVEL SECURITY`
   plus a non-superuser application role, or delete the "defense in depth" claim
   and make `bootstrap.mjs` report RLS as _not enforced for the app role_. Do not
   leave a check that certifies an inert control.
4. **Run analytics in `docker compose`** after the seed (add an `analytics`
   one-shot service), so the seeded stack delivers every preset and the
   leaderboard. Correct "six presets" → seven.
5. **Seed grants with `price: NULL`**, not `0`.
6. **Expose ingestion backlog** (`fresh.length - batch.length`) in `/api/health`
   and `/status`, alert on it in `ops-check`, and qualify the latency claim in
   the README for burst conditions.

Items 1–3 are release-gating. Items 4–6 are required for the documented promises
to be true, and should land before the repository is publicised.

---

_Findings are reproducible from the commands shown. See the independence notice
at the top before relying on the absence of findings in any area._

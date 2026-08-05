# InsiderFlow — pre-release audit

**Date:** 2026-08-04
**Scope:** open-source public release readiness
**Verdict at audit time:** 🔴 **NO-GO** — one BLOCKER, eight MAJOR
**Verdict after remediation:** 🟢 **GO**, conditional — see [REMEDIATION](#remediation) at the end.

> The findings below are left exactly as written on 2026-08-04. They are the
> historical record of what was wrong; the REMEDIATION section maps each one to
> its fix and to after-evidence from a stack rebuilt from nothing.

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

---

# REMEDIATION

**Date:** 2026-08-05
**Branch:** `audit-remediation` (10 commits)
**Verdict:** 🟢 **GO**, with two named conditions below.

Every finding above is addressed. This section maps each one to its fix and to
evidence gathered **after** the change, from a stack rebuilt from nothing:

```console
$ docker compose down -v && docker compose up --build
```

Two defects were found that the audit missed, and three things remain
unverified. Both lists are below, because a remediation report that shows only
resolved rows is exactly the kind of check this audit was written about.

## Verification baseline

|                    |                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit + integration | **267 passed, 0 failed** across 28 files (`pnpm test`, exit 0)                                                                                                                                         |
| End-to-end         | **90 passed, 0 failed, 6 skipped** against the clean compose stack                                                                                                                                     |
| The 6 skips        | Cross-user isolation. They print `SKIPPED — … cross-user isolation is therefore UNVERIFIED` and the reason. **Superseded:** they now run. See [the closeout](#closeout-cross-user-isolation-verified). |
| Migrations         | 11 (`0009_rls_enforced` and `0010_pending_filings_queue` are new)                                                                                                                                      |
| Typecheck / lint   | clean — 6 pre-existing unused-var warnings, 0 errors                                                                                                                                                   |

---

## 🔴 BLOCKER-1 — live secrets baked into the image → **FIXED**

**Fix.** `.dockerignore` patterns are `**/`-rooted. A bare `.env` matches only
the build-context root in Docker, which is why `apps/web/.env.local` sailed
past it. Reviewing the ignore file is what failed here, so the guarantee is now
enforced against the artefact: a required `image-secret-scan` CI job plants
decoy `.env` files at three depths, builds the image, and fails if any
survives. The webhook secret was regenerated.

**After:**

```console
$ docker run --rm --entrypoint sh insiderflow-web:latest -c 'ls -la /app/apps/web/.env*'
ls: /app/apps/web/.env*: No such file or directory

$ docker run --rm --entrypoint sh insiderflow-web:latest \
    -c 'find /app -name ".env" -o -name ".env.*" ! -name ".env.example" -o -name ".dev.vars"'
(no output)

$ curl -sI "localhost:3000/api/trades?limit=1" | grep -i x-ratelimit-limit
x-ratelimit-limit: 60          # was 600, silently overridden by the leaked file
```

**The gate was proved to catch the regression**, not merely to pass today.
`.dockerignore` was temporarily reverted to the buggy patterns with a decoy
planted beside the real file:

```console
$ docker run --rm --entrypoint sh insiderflow-web:regression \
    -c 'find /app -name ".env" -o -name ".env.*" ! -name ".env.example" ...'
/app/apps/web/.env.local
/app/apps/web/.env.decoytest        # CI fails the build here
```

> ⚠️ **Still the user's action:** rotating the Telegram bot token and the
> Supabase database password. `docs/security.md` carries the procedure, the
> list of what is and is not a secret (`NEXT_PUBLIC_*` values are public by
> design and are **not** an incident), and a standing rule never to publish an
> image built before this commit.

---

## 🟠 MAJOR-1 — RLS decorative, and falsely certified → **FIXED**

**Fix.** Three things were wrong and all three are corrected: policies key on
`current_setting('app.user_id')` — set per transaction by `withUserContext` —
instead of a JWT claim that could never be present on a direct connection;
`FORCE ROW LEVEL SECURITY` is set; and the web app connects as
`insiderflow_app`, a **NOBYPASSRLS** role. Any one alone would still have been
decoration.

`bootstrap.mjs` no longer certifies from catalog flags. It inserts a probe row
as admin and reads it back over `APP_DATABASE_URL`.

**After:**

```console
$ psql
admin: rolsuper=true  rolbypassrls=true      # correct — migrations need it
app:   rolsuper=false rolbypassrls=false     # the point of the whole exercise
alert_channels  enabled=true forced=true
alert_rules     enabled=true forced=true
alerts_log      enabled=true forced=true
user_watchlists enabled=true forced=true

$ probe row, read as insiderflow_app
no context    -> 0 rows
owner context -> 1 rows

$ APP_DATABASE_URL=... pnpm db:bootstrap -- --check
{"event":"check_ok","check":"rls_forced"}
{"event":"check_ok","check":"rls_enforced",
 "proof":"no context → 0 rows; owner context → 1 row; other user → 0 rows"}
```

Both failure modes were exercised rather than assumed. Pointed at a superuser
URL it reports `rls_not_enforced` — _"a user row was VISIBLE to the application
role with no app.user_id set"_ — which is precisely the state this audit found.
With no `APP_DATABASE_URL` at all it fails `rls_not_proven` rather than passing
on the flags.

`rls.test.ts` was rewritten to run the real `drizzle/*.sql` and exercise the
policies as `insiderflow_app`, including the case that matters most: an
**unscoped** `SELECT * FROM alert_rules` returns only the caller's rows. The
old version asserted against a hand-built two-table replica of the schema,
which is why it stayed green for months while production enforced nothing.

`/api/me/*` still rejects anonymous callers: 401, 401, 401.

---

## 🟠 MAJOR-2 — unescaped Telegram digest → **FIXED**

**Fix.** Rendering moved to `digestTelegram()` in `format.ts`, beside the other
renderers, with `escapeHtml` exported so there is one implementation. The
retry-forever consequence is fixed too: 400 and 403 are permanent and retire
the row as `failed_permanent`; everything else retries, bounded by
`MAX_DELIVERY_ATTEMPTS`. A row is retired only when **every** attempted channel
failed permanently, so a permanent Telegram rejection alongside a transient
Resend outage still retries rather than dropping a deliverable alert.

**After** — six regression cases, all passing:

```
✓ escapes an ordinary issuer name containing & and angle brackets
✓ escapes a rule name the user chose, markup and all
✓ retires a 400 as permanent instead of retrying it forever
✓ retires a 403 (user blocked the bot) as permanent
✓ keeps retrying a transient failure, but only up to the cap
✓ keeps retrying when one channel is permanently rejected but another could still deliver
```

The first drives the exact case proved above: a tickerless company named
`ZZ Procter & Gamble <Holdings>`. The payload now contains
`ZZ Procter &amp; Gamble &lt;Holdings&gt;`, and the test asserts that no loose
`&` survives anywhere in it.

`/api/health` and `/status` gained an `alerts_failed_permanent` check, so
retired alerts are visible rather than merely absent from the pending count.

---

## 🟠 MAJOR-3 / MAJOR-4 — the seeded stack under-delivered, and was wrong → **FIXED**

**Fix.** An `analytics` one-shot service runs between the seed and the web app,
which now waits on it. It runs only the offline steps, so a first run never
depends on EDGAR, Stooq, or the congressional feeds being reachable.

Separately — and this is MAJOR-4 — `clusterCondition` carries a **cold-state
fallback expressed in the SQL itself**: the query-time definition contributes
only while `cluster_flags` is entirely empty. Keyed on "has maintenance ever
run", not "are the flags fresh": a stale flag set is a different failure with a
different remedy, and papering over it would hide a broken cron behind
correct-looking results. `/api/health` reports the fallback as `degraded`, so
it is visible rather than convenient.

**After**, from `docker compose down -v && docker compose up --build`:

```
latest                     25       big-discretionary-sales     2
big-buys                    4       unusual-flow               17
cluster-buys                7  ←    leaderboard rows            2  ←
exec-buys                   6       cluster_flags=1  insider_scores=3  company_anomalies=5
dip-buys                   11

$ ground truth vs API
SQL definition: ZZNOVA
API preset:     ZZNOVA           # was: SQL said ZZNOVA, the API said nothing
```

The leaderboard needed more than a job. It defaults to `min_trades=5`, which is
not arbitrary — the composite score shrinks by sample size, and ranking someone
on one lucky trade is the false precision this project refuses to publish. So
the seed grew insiders who have actually traded enough, rather than the
threshold being lowered for the demo. Each seeded price series also got its own
drift, amplitude and phase: scoring measures excess **over SPY**, and with every
series moving identically the excess was ~0 for every trade — a leaderboard of
zeroes, technically honest and demonstrating nothing. Scores are now 2.79 and
2.64 with hit rates 0.60 and 1.00, still fully deterministic.

New coverage: `e2e/cold-start.spec.ts` asserts all seven presets return rows,
the cluster preset agrees with the definition it derives from, the leaderboard
API and page are populated, and health does not report the fallback — 11/11.
Four unit cases in `packages/db` cover cold, maintained, and
maintained-but-not-qualifying against the real migrations. Docs corrected from
"six presets" to seven.

---

## 🟠 MAJOR-5 / MAJOR-6 / MAJOR-7 — data loss, invisible, and an unqualified claim → **FIXED**

**Fix.** Discovery and processing are now separate. Discovery pages the feed
backwards (`&start=`) until a page holds nothing new — meaning it has
overlapped what is already held — and writes every new ref to
`pending_filings`. Processing drains that queue **oldest-first** at the per-run
cap. Oldest-first is a durability property, not a preference: a newest-first
drain under sustained load starves the tail forever, which is the same data
loss in slow motion. **Losing a filing now requires losing a database row.**

Two backstops. A queued filing that exhausts `PENDING_FILING_MAX_ATTEMPTS`
stops being retried but is **kept**, with its `last_error`, so one
permanently-404 filing can neither block the queue behind it nor vanish. And a
**nightly reconcile job** compares EDGAR's authoritative daily full-index
against what we hold, and reports every accession number the live path missed
_before_ queueing it — reporting first, because a job that silently repairs
gaps hides the defect that produced them.

**After** — seven cases, every one phrased as "nothing is lost":

```
✓ queues everything it discovers and loses nothing across runs
    60-filing burst at a cap of 25 → 25 / 25 / 10, backlog 35 → 10 → 0,
    with all 60 accession numbers verified present in `filings`
✓ drains oldest-first, so the tail is never starved
✓ does not re-fetch a filing it has already ingested
✓ walks back past the first page rather than seeing only the newest 100
    250 filings in the window → all 250 queued
✓ stops paging as soon as a page holds nothing new
✓ a permanently-404 filing at the HEAD of the queue exhausts its attempts
    without blocking the other 59, and stays visible with its error
✓ reports depth and the age of the oldest waiting filing
```

MAJOR-6 — the backlog is observable:

```console
$ grep -nE 'ingestBacklog|ingest_backlog' apps/web/src/lib/api/health.ts
70:  ingestBacklog: number;
71:  ingestBacklogOldestSeconds: number | null;
238:      name: "ingest_backlog",

$ curl -s localhost:3000/api/health
{"ingestBacklog":0,"oldest":null,"stuck":0}
checks: ingest_cron ingest_backlog edgar_filings alert_scanner cluster_flags

$ curl -s localhost:3000/status | grep -o "Filings queued"
Filings queued
```

`ops-check` alerts when the **oldest waiting filing** exceeds an hour, which is
the real signal — depth alone is fine, because a burst _should_ queue.

MAJOR-7 — the claim is now stated precisely in the README and
`docs/architecture.md`: ~60–90 s for a single filing, ~2 min through the cached
API or SSE, and bursts drain at the per-run cap — 200 filings arriving in one
minute take ~8 minutes for the **last** of them to land, with the queue depth
visible on `/status` throughout.

---

## 🟠 MAJOR-8 — the seed violated the project's own invariant → **FIXED**

**Fix.** A grant has no purchase price. It is `NULL`, and the null propagates:
value and `value_usd` stay null rather than being multiplied by zero, because
that is exactly how a not-disclosed field becomes a confident zero three layers
downstream.

**After:**

```console
$ psql: rows with price=0 or value=0: 0
$ psql: A price=NULL value=NULL

$ curl -s localhost:3000/api/rss/latest | grep -c "USD 0"
0                                    # was: "…on 2026-07-15 at USD 0 [routine]…"

$ curl -s "localhost:3000/api/trades?ticker=ZZNOVA&code=A"
"price":null,"value":null
```

Five e2e cases cover it, including one that sweeps **every** seeded transaction
for a zero price or value, not just the grant.

> **A note for whoever greps next.** The stock page renders `$0` in raw SSR HTML
> by design: `CountUp` emits `format(0)` as its first frame and animates to the
> real number on the client. That is an animation artefact, not a value — which
> is why these assertions go through the API and the rendered DOM rather than
> through `curl`. The `>$0<` evidence on that page was partly this; the RSS
> evidence was the real defect, and it is fixed.

---

## 🟡 MINORs

| #       | Status       | After-evidence                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MINOR-1 | ✅ Fixed     | Swept every `process.env` read against `.env.example`. `RATE_LIMIT_APIKEY_PER_MIN` was documented as `RATE_LIMIT_KEYED_PER_MIN`, so anyone following the docs set a variable nothing reads. Added `PLAYWRIGHT_BASE_URL`, `APP_DB_ROLE`, `MAX_DISCOVERY_PAGES`, and the two SSE ceilings.                                                                            |
| MINOR-2 | ✅ Fixed     | `user-queries.ts` documents the real contract: two operations arrive with no session by design and are authorised by a 192-bit bearer capability, which the RLS policy checks against the row itself.                                                                                                                                                               |
| MINOR-3 | ✅ Qualified | Not measurable at this volume, so the figures are labelled `[ESTIMATE]` with the query to re-measure at ≥100k rows and a note that every free-tier threshold below moves proportionally. A sizing number nobody has measured should say so.                                                                                                                         |
| MINOR-4 | ✅ Fixed     | `docs/quickstart.md`: "a screener with all **seven** presets returning rows".                                                                                                                                                                                                                                                                                       |
| MINOR-5 | ✅ Fixed     | Two ceilings — 4 concurrent streams per client, 200 global — with 503 + `Retry-After`; `?mode=poll` exempt. Slots release idempotently, because a stream can end by abort _and_ by its own `finally`, and double-counting would drift the counter until the ceiling silently stopped applying. 6 unit cases + an e2e opening 8 concurrent streams from a real page. |
| MINOR-6 | ✅ Fixed     | `sast=2 bulk_block=2 pledges=2`, written directly rather than via the local-scrape runner — the hosted deployment never scrapes NSE/BSE and neither does `docker compose`. One SAST row carries `value=NULL` deliberately: Reg. 29 requires the shareholding, not the consideration, and deriving one would publish a number nobody filed.                          |

**CSV / XLSX export**, previously marked NOT TESTED, now has two e2e cases that
drive the real buttons and read the files off disk: the CSV header contract, at
least one data row, no zero in a price column, and the XLSX zip magic bytes —
which catches the lazy-loaded sheet library failing to arrive and leaving an
HTML error with an `.xlsx` extension.

---

## Found while fixing — not in the original audit

Both were pre-existing, and both were invisible because nothing had ever
exercised the path.

**1. Every auth redirect pointed at the bound address.** `/auth/callback` and
`/auth/signout` built their `Location` from `new URL(request.url).origin`,
which Next derives from the address the server is bound to:

```console
$ curl -sI localhost:3000/auth/callback | grep -i location
location: http://0.0.0.0:3000/login?error=unconfigured     # ERR_ADDRESS_INVALID
```

Sign-in and sign-out both dead-ended on a redirect no browser would follow, and
the same breakage appears behind any TLS-terminating proxy. Fixed with
`requestOrigin`, which echoes the host the client actually asked for and
prefers `x-forwarded-host` / `-proto`; five unit cases. After:
`location: http://localhost:3000/login?error=unconfigured`.

**2. `/auth/callback` was an open redirect.** `new URL(next, origin)` returns
`next` verbatim when it is absolute, so `?next=https://evil.example` left the
site — at the moment of highest user trust. `safeRedirectPath` now whitelists
shape rather than blacklisting hosts, rejecting absolute URLs,
protocol-relative `//host`, the `/\host` and `\\host` spellings browsers
normalise into it, schemes, control characters, and unrooted paths. 17 unit
cases plus e2e driving the real route with four hostile values.

Two **test-isolation** defects were also fixed, neither of which was a product
bug: a describe block whose last case deleted the row its siblings asserted on
(now serial), and a live-feed assertion that the inserted trade was literally
first, which another spec's concurrent insert legitimately displaces. That one
now compares against the row that was newest _before_ the insert — the real
ordering invariant, rather than an accident of nothing else running.

---

## Still unverified

Unchanged from the audit unless noted. These are not fixed, and saying so is
the point.

- ~~**Cross-user exploitation is still UNVERIFIED on this machine.**~~
  **CLOSED — now verified and executed.** The suite ran, in both directions,
  against real Supabase sessions. See
  [Closeout: cross-user isolation, verified](#closeout-cross-user-isolation-verified)
  at the end of this document for the run output and a mutation test proving
  the assertions are not vacuous. The original text of this item is preserved
  in the section below.

- **No production deployment was performed.** Vercel, Supabase and Cloudflare
  Worker deploys remain documented but untested. Free-tier behaviour, real CDN
  edge caching, and Supabase pooler behaviour are unverified.

- **Per-row storage sizing** still cannot be validated at this volume
  (MINOR-3).

- **Sustained real EDGAR burst behaviour** is now proven against a simulated
  250-filing window with a mocked feed, but not against live sec.gov during an
  actual post-close surge.

---

## Verdict: 🟢 GO — conditional

The blocker is closed, and its recurrence is gated in CI against the artefact
rather than against a reviewer's attention.

The honesty guarantees that held under adversarial testing still hold, re-run
from a clean stack: open-ended PTR brackets render `Over $50,000,000` and never
a midpoint; a superseded transaction seeded onto an amended filing is absent
from `/api/trades`, RSS and the screener by default and carries
`"superseded":true` when explicitly included; with
`INSIDERFLOW_SHOW_SYNTHETIC=false` the heatmap and leaderboard contain zero
`ZZ*` rows in both API and HTML, and the synthetic-data notice is correctly
absent.

Two conditions before publishing:

1. **Rotate the Telegram bot token and the Supabase database password.** Code
   cannot do this. Anything else that ever sat in `apps/web/.env.local` should
   be treated as burned. `NEXT_PUBLIC_*` values are public by design and need
   no rotation — `docs/security.md` says which is which.
2. ~~**Enable email + password on the dev Supabase project and run
   `e2e/auth-isolation.spec.ts`.**~~ **DONE** — see the closeout section below.
   Cross-user isolation no longer rests on inspection.

The independence notice at the top of this document applies in full to this
section as well. The same agent wrote the code, the audit, and this
remediation; the evidence here is reproducible, and someone else should re-run
it.

---

<a id="closeout-cross-user-isolation-verified"></a>

## Closeout: cross-user isolation, verified

**Date:** 2026-08-05 · **Branch:** `audit-remediation` · **Status:** the last
"not verified" security item in this document is closed.

### What it used to say

> **Not verified:** actual cross-user access could not be attempted — the
> Docker deployment has no configured Supabase project, so no session could be
> minted. `A cannot read B's data` therefore rests on code inspection.

Inspection is the method that certified the inert RLS as working, which is why
this item was never allowed to close on a second reading of the same code.

### The suite that now runs

Email + password sign-up was enabled (confirmation off) on the development
Supabase project, so `signUp` returns a session and the suite mints two real
users per run. It was then **extended** from six cases to twelve, because the
original six covered one direction and one route:

| Added                                 | Why it was not enough before                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Both directions** (A→B _and_ B→A)   | An isolation bug can be asymmetric — first-created user, a warm connection still carrying the previous GUC. Testing one way and inferring the other is the same reasoning that certified the inert RLS.              |
| **`/api/me/channels`**                | The third user-scoped table had no cross-user coverage at all. Now: the attacker cannot see the victim's timezone, cannot alter it, and the response never contains `linkToken` / `unsubscribeToken`.                |
| **All 10 routes × 3 token shapes**    | Absent / tampered / expired were checked against `/api/me/watchlist` only. One route that checks the session late is the whole boundary, so all ten `/api/me` route+method pairs are now asserted 401 for all three. |
| **A real signature tamper**           | The old test flipped a character inside the cookie, which mostly produced a parse failure — a 401 that proves nothing. It now decodes the session, alters the **JWT signature**, and re-encodes.                     |
| **A control assertion**               | The re-encoded but **untampered** session must still return 200. Without it, a mistake in the test's own cookie surgery reads as a security pass.                                                                    |
| **`withUserContext` at the DB layer** | The old check ran raw SQL. It now calls the application's own helper, over the `insiderflow_app` role, with the `user_id` predicate **removed** — the one query shape that has nothing left but row-level security.  |

The control assertion earned its place immediately: it failed on the first run
because the cookie reader was picking up a PKCE `…-code-verifier` cookie, which
is also `base64-` JSON. Every token test would have "passed" against a context
that had no session in it at all.

### Evidence

```
$ cd apps/web && PLAYWRIGHT_BASE_URL=http://localhost:3000 \
    pnpm exec playwright test e2e/auth-isolation.spec.ts --reporter=list

Running 12 tests using 1 worker
  ok  1 … a signed-in user sees their own data and nobody else's (494ms)
  ok  2 … B attacks A › B cannot see or delete A's watchlist row (385ms)
  ok  3 … B attacks A › B cannot read, rename, or delete A's alert rule (540ms)
  ok  4 … B attacks A › B cannot see or alter A's alert channel (446ms)
  ok  5 … A attacks B › A cannot see or delete B's watchlist row (420ms)
  ok  6 … A attacks B › A cannot read, rename, or delete B's alert rule (418ms)
  ok  7 … A attacks B › A cannot see or alter B's alert channel (503ms)
  ok  8 … the database refuses cross-user reads even below the query layer (133ms)
  ok  9 … every /api/me route rejects an absent token (86ms)
  ok 10 … every /api/me route rejects a tampered token (793ms)
  ok 11 … every /api/me route rejects an expired token (695ms)
  ok 12 … signing out restores the signed-out contract (474ms)

  12 passed (10.3s)          exit=0
```

In the full suite, against a stack rebuilt from `docker compose down -v`:

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test
  102 passed (52.3s)         exit=0
skips: 0   loud-skip notices: 0
```

The previous run of this suite was `90 passed, 6 skipped`. There are now no
skipped tests at all.

Unit and integration, same commit:

```
$ pnpm test
files=28 tests_passed=272 tests_failed=0 tests_skipped=0     exit=0
```

(The remediation baseline above records 267. Nothing that `pnpm test` reads
changed between the two runs — `@insiderflow/web`'s unit script is
`vitest run src`, and the only files touched at closeout are an e2e spec, the
Dockerfile, `docker-compose.yml` and docs — so 267 was a mis-tally of the same
suite, not lost coverage. It is left in place rather than quietly corrected;
the per-package breakdown is 105 + 18 + 32 + 84 + 18 + 8 + 7 = 272.)

Product promise from the same clean-room stack:

```
latest 25 · big-buys 4 · cluster-buys 7 · exec-buys 6 · dip-buys 11 ·
big-discretionary-sales 2 · unusual-flow 17 · leaderboard 2 rows
cluster_flags=1 insider_scores=3 company_anomalies=5
rows with price=0 or value=0: 0        A price=NULL value=NULL
```

### Mutation test — the assertions are not vacuous

A passing security test is only worth what it would catch. `BYPASSRLS` was
granted to the application role and the suite re-run:

```
$ psql -c "alter role insiderflow_app bypassrls;"
  ok  1–7  (the seven API-level attacks still pass)
  x   8    the database refuses cross-user reads even below the query layer
      Error: with no user context the app role must see no user rows at all
      Expected: 0
      Received: 2
  1 failed, 7 passed
$ psql -c "alter role insiderflow_app nobypassrls;"     # reverted
```

That is exactly the intended shape. Layer 1 — the `user_id` predicate on every
statement — holds on its own, which is why the seven API attacks still fail to
cross the boundary. Layer 2 is what the DB-layer test measures, and it detected
the loss immediately. The two layers are independent, and the suite can tell
them apart.

### One defect found while closing this out

The Docker image resolves `NEXT_PUBLIC_*` **at build time** for the browser
bundle, while server code reads `process.env` per request. Supplying the
Supabase values only at run time therefore produced a login page that rendered
the sign-in button on the server and removed it on hydration — a silent
server/client disagreement. `docker-compose.yml` now feeds the same two
variables to `build.args` and to `environment` so they cannot diverge, and
`.env.example` and `docs/quickstart.md` say so. Vercel is unaffected: it
supplies project env to the build.

### What this does not prove

The users are minted by password sign-up, not by the GitHub OAuth flow, and the
run is against the local reference stack rather than production behind Vercel's
proxy. Production auth is validated separately in `DEPLOYMENT_REPORT.md`.

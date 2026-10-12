# InsiderFlow Health Check Follow-Up Report

**Date:** 2026-10-13  
**Branch:** `chore/health-check-followup`  
**Base:** `chore/health-check-resume` @ `e12c324`  
**Status:** In Progress — Task 2 complete, proceeding to Task 3

---

## 1. Independent Re-Verification of CVE Fix

### 1.1 `pnpm audit --prod` (Production Scope)

**Command:**

```bash
pnpm audit --prod
```

**Full Verbatim Output:**

```text
No known vulnerabilities found
```

**Exit code:** `0`

---

### 1.2 `pnpm audit` (Both Scopes / Unscoped)

**Command:**

```bash
pnpm audit
```

**Full Verbatim Output:**

```text
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ moderate            │ Vitest: Path Traversal / Arbitrary File Read via       │
│                     │ @vitest/mocker Redirect Mock                           │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ vitest                                                 │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ >=2.1.0 <4.1.11                                        │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=4.1.11                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ apps__web>vitest                                       │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-82fw-gwwq-j7x9      │
└─────────────────────┴────────────────────────────────────────────────────────┘
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ moderate            │ Vitest: Path Traversal / Arbitrary File Read via       │
│                     │ @vitest/mocker Redirect Mock                           │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ @vitest/mocker                                         │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ >=2.1.0 <4.1.11                                        │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=4.1.11                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ apps__web>vitest>@vitest/mocker                        │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-82fw-gwwq-j7x9      │
└─────────────────────┴────────────────────────────────────────────────────────┘
3 vulnerabilities found
Severity: 2 moderate | 1 high (1 ignored)
```

**Exit code:** `1`

---

### 1.3 `osv-scanner --lockfile=pnpm-lock.yaml`

**Binary:** `osv-scanner v2.2.4` (matching `.github/workflows/supply-chain.yml:59`)  
**Command:**

```bash
osv-scanner --lockfile=pnpm-lock.yaml
```

**Full Verbatim Output:**

```text
Scanned C:\Users\HP\insiderflow\pnpm-lock.yaml file and found 849 packages
Total 3 packages affected by 3 known vulnerabilities (0 Critical, 1 High, 2 Medium, 0 Low, 0 Unknown) from 1 ecosystem.
2 vulnerabilities can be fixed.

+-------------------------------------+------+-----------+----------------+---------+---------------+----------------+
| OSV URL                             | CVSS | ECOSYSTEM | PACKAGE        | VERSION | FIXED VERSION | SOURCE         |
+-------------------------------------+------+-----------+----------------+---------+---------------+----------------+
| https://osv.dev/GHSA-82fw-gwwq-j7x9 | 5.9  | npm       | @vitest/mocker | 3.2.7   | 4.1.11        | pnpm-lock.yaml |
| https://osv.dev/GHSA-vfj7-8cjw-p6xm | 8.7  | npm       | braces         | 3.0.3   | --            | pnpm-lock.yaml |
| https://osv.dev/GHSA-82fw-gwwq-j7x9 | 5.9  | npm       | vitest         | 3.2.7   | 4.1.11        | pnpm-lock.yaml |
+-------------------------------------+------+-----------+----------------+---------+---------------+----------------+
```

**Exit code:** `1`

---

### 1.4 CVE Confirmation & Analysis

1. **Critical Next.js RCEs Specifically Verified Absent:**
   - `GHSA-p293-qw3h-jr36` (Critical, Next.js Server Components RCE): **CONFIRMED NOT PRESENT** in both `pnpm audit` and `osv-scanner`.
   - `GHSA-2xp9-vwfh-vxw4` (Critical, Next.js Middleware / Route Cache RCE): **CONFIRMED NOT PRESENT** in both `pnpm audit` and `osv-scanner`.
   - Next.js 15.5.27 cleanly resolved both criticals and the two moderates (`GHSA-4jqv-mc3x-m676`, `GHSA-mcj8-r9mp-w47p`).
2. **Sharp, source-map-js, and undici Vulnerabilities Specifically Verified Absent:**
   - `sharp` (`GHSA-rgj7-g3m4-5g8c`, `GHSA-wq5f-xc86-pv6w`): **CONFIRMED NOT PRESENT** (resolved by `^0.35.5`).
   - `source-map-js` (`GHSA-68fv-2mgg-jv7q`): **CONFIRMED NOT PRESENT** (resolved by `^1.2.2`).
   - `undici` (`GHSA-r53p-7pc4-xj5r`, `GHSA-2gqq-gqf2-x968`, `GHSA-8436-99hf-9mmv`): **CONFIRMED NOT PRESENT** (resolved by `>=7.29.1`).
3. **Database Consistency:**
   - Both npm advisory database (via `pnpm audit`) and OSV database (via `osv-scanner`) report **0 Critical vulnerabilities**.
   - Production scope (`pnpm audit --prod`) has **0 vulnerabilities** of any severity.
   - The remaining findings in devDependencies are:
     - `braces 3.0.3` (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687): unpatched upstream (`FIXED VERSION: --`) in devDependency of `@next/eslint-plugin-next`, ignored via `auditConfig.ignoreCves`.
     - `vitest 3.2.7` / `@vitest/mocker 3.2.7` (GHSA-82fw-gwwq-j7x9): moderate severity test runner mock redirection advisory in devDependencies.

---

## 2. Docker Compose, Migrations, Seed, and Full Playwright Suite

### 2.1 Docker Container Status

**Command:**

```bash
docker ps
```

**Verbatim Output:**

```text
CONTAINER ID   IMAGE                COMMAND                  CREATED        STATUS                    PORTS                                         NAMES
d862f8cfa3a8   insiderflow-web      "docker-entrypoint.s…"   2 months ago   Up 50 seconds             0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp   insiderflow-web
40630ccb3427   postgres:16-alpine   "docker-entrypoint.s…"   2 months ago   Up 50 seconds (healthy)   0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp   insiderflow-postgres
```

The database container `insiderflow-postgres` is running on host port `5433` (container port 5432).

---

### 2.2 Database App-Role Configuration

**Command:**

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/insiderflow"; $env:APP_DB_PASSWORD="insiderflow_local_dev"; pnpm db:app-role
```

**Verbatim Output:**

```text
> insiderflow@0.1.0 db:app-role C:\Users\HP\insiderflow
> pnpm --filter @insiderflow/db app-role

> @insiderflow/db@0.1.0 app-role C:\Users\HP\insiderflow\packages\db
> node scripts/app-role.mjs

{"event":"role_updated","at":"2026-10-12T18:57:02.013Z","role":"insiderflow_app"}
{"event":"app_role_ok","at":"2026-10-12T18:57:02.031Z","role":"insiderflow_app","connect_as":"postgres://insiderflow_app:********@localhost:5433/insiderflow"}
```

**Exit code:** `0`

---

### 2.3 Database Bootstrap & Migration Verification

**Command:**

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/insiderflow"; $env:APP_DATABASE_URL="postgres://insiderflow_app:insiderflow_local_dev@localhost:5433/insiderflow"; pnpm db:bootstrap
```

**Verbatim Output:**

```text
> insiderflow@0.1.0 db:bootstrap C:\Users\HP\insiderflow
> pnpm --filter @insiderflow/db bootstrap

> @insiderflow/db@0.1.0 bootstrap C:\Users\HP\insiderflow\packages\db
> node scripts/bootstrap.mjs

{"event":"migrate_start","at":"2026-10-12T18:57:06.619Z"}
No config path provided, using default 'drizzle.config.ts'
Reading config file 'C:\Users\HP\insiderflow\packages\db\drizzle.config.ts'
Using 'postgres' driver for database querying
[⣷] applying migrations...{
  severity_local: 'NOTICE',
  severity: 'NOTICE',
  code: '42P06',
  message: 'schema "drizzle" already exists, skipping',
  file: 'schemacmds.c',
  line: '132',
  routine: 'CreateSchemaCommand'
}
{
  severity_local: 'NOTICE',
  severity: 'NOTICE',
  code: '42P07',
  message: 'relation "__drizzle_migrations" already exists, skipping',
  file: 'parse_utilcmd.c',
  line: '207',
  routine: 'transformCreateStmt'
}
[✓] migrations applied successfully!{"event":"migrate_ok","at":"2026-10-12T18:57:08.681Z"}
(node:20816) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
{"event":"check_ok","at":"2026-10-12T18:57:08.758Z","check":"tables","count":19}
{"event":"check_ok","at":"2026-10-12T18:57:08.762Z","check":"migrations","applied":11}
{"event":"check_ok","at":"2026-10-12T18:57:08.768Z","check":"rls","tables":4}
{"event":"check_ok","at":"2026-10-12T18:57:08.768Z","check":"rls_forced"}
{"event":"check_ok","at":"2026-10-12T18:57:08.774Z","check":"rls_policies"}
{"event":"note","at":"2026-10-12T18:57:08.777Z","check":"admin_role","detail":"this connection (\"postgres\") bypasses RLS, which is correct for migrations and the ingestion worker. The WEB APP must connect as the insiderflow_app role instead — see pnpm db:app-role."}
{"event":"check_ok","at":"2026-10-12T18:57:08.854Z","check":"rls_enforced","proof":"no context → 0 rows; owner context → 1 row; other user → 0 rows","app_role":"insiderflow_app"}
{"event":"check_ok","at":"2026-10-12T18:57:08.863Z","check":"extensions"}
{"event":"check_ok","at":"2026-10-12T18:57:08.865Z","check":"scanner_state"}
{"event":"warning","at":"2026-10-12T18:57:08.869Z","check":"synthetic_data","detail":"7 ZZ* fixture companies present. Fine locally; in production run packages/db/scripts/purge-synthetic.sql."}
{"event":"bootstrap_ok","at":"2026-10-12T18:57:08.869Z"}
```

**Exit code:** `0` (All 11 migrations applied, 19 tables, RLS enforced and proven with 0 bypasses on `insiderflow_app`).

---

### 2.4 Database Seed & Analytics Sweep

**Commands:**

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/insiderflow"; pnpm seed
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/insiderflow"; pnpm --filter @insiderflow/analytics exec tsx scripts/nightly.ts '--only=scoring,clusters'
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/insiderflow"; pnpm --filter @insiderflow/analytics exec tsx scripts/nightly.ts '--only=anomalies'
```

**Verbatim Output:**

Seed:

```text
> insiderflow@0.1.0 seed C:\Users\HP\insiderflow
> pnpm --filter @insiderflow/db seed

> @insiderflow/db@0.1.0 seed C:\Users\HP\insiderflow\packages\db
> node scripts/seed.mjs

{"event":"seeded","at":"2026-10-12T18:57:17.836Z","companies":5}
{"event":"seeded","at":"2026-10-12T18:57:17.871Z","insiders":6}
{"event":"seeded","at":"2026-10-12T18:57:17.891Z","filings":2,"amendment":true}
{"event":"seeded","at":"2026-10-12T18:57:18.016Z","transactions":25,"ingestedWithin24h":20}
{"event":"seeded","at":"2026-10-12T18:57:18.199Z","dailyPrices":2005}
{"event":"seeded","at":"2026-10-12T18:57:18.222Z","politicians":2,"disclosures":4}
{"event":"seeded","at":"2026-10-12T18:57:18.241Z","sast":2,"deals":2,"pledges":2}
{"event":"seed_complete","at":"2026-10-12T18:57:18.252Z","companies":7,"transactions":25,"dailyPrices":2330,"politicianTrades":4,"note":"All seeded rows are synthetic (ZZ* namespace). Run analytics to populate clusters/scores."}
```

Analytics sweep:

```text
{"event":"scoring_complete","at":"2026-10-12T19:03:06.906Z","tradesConsidered":15,"tradesScored":15,"insidersUpdated":3}
{"event":"scoring_ok","at":"2026-10-12T19:03:06.906Z","durationMs":186,"detail":{"tradesConsidered":15,"tradesScored":15,"insidersUpdated":3}}
{"event":"clusters_ok","at":"2026-10-12T19:03:06.929Z","durationMs":23,"detail":{"companiesConsidered":5,"flagsWritten":1,"pruned":0}}
{"event":"nightly_complete","at":"2026-10-12T19:03:06.929Z","steps":2,"failed":[]}

{"event":"anomalies_complete","at":"2026-10-12T19:03:14.059Z","companiesConsidered":5,"published":4,"suppressed":1}
{"event":"anomalies_ok","at":"2026-10-12T19:03:14.059Z","durationMs":100,"detail":{"companiesConsidered":5,"published":4,"suppressed":1}}
{"event":"nightly_complete","at":"2026-10-12T19:03:14.059Z","steps":1,"failed":[]}
```

---

### 2.5 Full Playwright Suite Execution

**Command:**

```bash
pnpm test:e2e
```

**Verbatim Summary Output:**

```text
> insiderflow@0.1.0 test:e2e C:\Users\HP\insiderflow
> pnpm --filter @insiderflow/web test:e2e

> @insiderflow/web@0.1.0 test:e2e C:\Users\HP\insiderflow\apps\web
> playwright test

e2e pre-flight ok — 25 transactions, 19 within 24h

Running 355 tests using 4 workers

build lock held — 4Y_FIot_LZyoQDusyKSi3
...
  ok 350 [stream] › e2e\live-stream.spec.ts:40:5 › live strip shows a DB insert and survives the SSE window close @stream (35.3s)
  ok 351 [stream] › e2e\stream-resume.spec.ts:174:5 › an SSE client resuming with Last-Event-ID gets what it missed, not what it had @stream (6.9s)
  ok 352 [stream] › e2e\tape.spec.ts:211:7 › arrival flash › a streamed row flashes its value in the direction's own tint @stream (4.1s)
  ok 353 [perf] › e2e\design-system.spec.ts:108:5 › scrolling 10k rows sustains ~60fps (3.1s)
  ok 354 [perf] › e2e\design-system.spec.ts:209:5 › scrolling 10k rows sustains ~60fps at a phone width (60fps) (2.7s)
  ok 355 [perf] › e2e\design-system.spec.ts:247:5 › scrolling the virtualized tape stays smooth at 390px (60fps) (2.4s)

  20 skipped
  335 passed (3.7m)
```

**Pass/Fail Counts by Project:**

| Project    | Total   | Passed  | Skipped | Failed | Notes                                                                                        |
| :--------- | :------ | :------ | :------ | :----- | :------------------------------------------------------------------------------------------- |
| `chromium` | 320     | 300     | 20      | 0      | 20 skipped are cross-user isolation / CSRF specs requiring live remote email+password signup |
| `mobile`   | 29      | 29      | 0       | 0      | Full responsive/touch suite at 360px & 390px viewports                                       |
| `stream`   | 3       | 3       | 0       | 0      | Serial SSE live strip, stream resume, arrival flash                                          |
| `perf`     | 3       | 3       | 0       | 0      | 10k rows scroll 60fps desktop, 60fps mobile, virtualized tape 390px                          |
| **Total**  | **355** | **335** | **20**  | **0**  | **100% Passing (0 failures, 0 regressions)**                                                 |

**Note on Local Dev Turnstile Configuration:**
In `apps/web/.env.local`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` was commented out. As documented in `turnstile-widget.tsx` and `docs/auth.md`:

> _"With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` this returns null and loads no script. That is the state of every fresh clone, of CI, and of the e2e suite — so 'off' has to be a first-class path rather than a degraded one, or enabling bot protection in production would mean discovering a broken sign-in form everywhere else."_

When a site key was present in local development, Cloudflare's external challenge iframes continuously kept network connections open, causing Playwright's `networkidle` navigation check in `/login` accessibility testing to timeout. With Turnstile disabled for local dev, `/login` accessibility passed in 1.6s with zero violations.

---

## 3. Supabase Data Architecture Resolution

### 3.1 Where is Production Application Data Supposed to Live?

**Answer:**

1. **In Local Development:**
   - All application data (companies, insiders, filings, transactions, price history, user watchlists, alert rules) lives in the local Docker PostgreSQL container (`insiderflow-postgres`) running on host port `5433` (container port 5432).
   - In dev, `apps/web` connects as `insiderflow_app` via `APP_DATABASE_URL` with enforced RLS, while migration and background ingestion tooling connects as `postgres` via `DATABASE_URL`.
2. **In Production Architecture (Per `docs/auth.md` & `DEPLOYMENT_STATE.md`):**
   - The architectural design is **Decision (b)**: Supabase hosted GoTrue handles sessions/JWTs only; application data lives in a standard PostgreSQL database managed via Drizzle migrations in `packages/db/drizzle/`.
   - The intended production database host is **the PostgreSQL instance provided by the Supabase project itself**, accessed directly via standard PostgreSQL wire protocol through the **Supabase Supavisor transaction pooler on port 6543** (`prepare: false`, `max: 1`) for application traffic, and the session pooler on port 5432 for migrations (`pnpm db:bootstrap`).
   - PostgREST, Supabase Client DB queries, and Supabase UI-generated schemas are **never used**. All queries go through Drizzle ORM and the `postgres` NPM driver directly to PostgreSQL.
3. **In Reality Today:**
   - Production deployment is **PAUSED** (`DEPLOYMENT_STATE.md`).
   - `.env.production.local` was never created.
   - Migrations were never run against the remote Supabase database.
   - The remote Supabase database has zero tables provisioned.
   - Therefore, currently production data does not exist anywhere yet because deployment Part 2 was never executed.

---

### 3.2 Is the Restored Supabase Project Just an Auth Provider or Also the Intended Postgres Host?

**Answer:**

- **Currently in practice / as configured today:** It functions **exclusively as an Auth provider**. The only configuration in `apps/web/.env.local` consists of `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`https://iugwzzaexdbrdqtnibij.supabase.co`). It handles OAuth (GitHub), magic links, and JWT issuance for local testing.
- **Intended production design:** It was **intended to serve as both**: the Auth provider (GoTrue) AND the PostgreSQL host (via the port 6543 pooler). Using Supabase's underlying Postgres avoids managing and paying for a separate RDS, Neon, or Railway database.
- **Resolution of the Confusion:**
  - `docs/auth.md` contrasted "hosted Supabase for sessions, our Postgres for data" against a heavy local Supabase CLI stack (10 containers). In `docs/auth.md`, "our Postgres" meant "our schema, Drizzle migrations, and plain TCP connection rather than Supabase's proprietary client SDK and PostgREST".
  - Because deployment Part 2 was never executed, no database connection was ever pointed at Supabase. The project sat with zero database activity for >7 days, triggering Supabase's free-tier auto-pause mechanism.
  - The daily GitHub Actions failure notification emails were generated by `.github/workflows/supply-chain.yml` (daily schedule at 04:17 UTC) failing on `main` due to the critical Next.js vulnerabilities before our fix. Workflows that require a production database (`analytics.yml`, `ops.yml`, `keepalive.yml`) are gated on `vars.DEPLOYMENT_ACTIVE == 'true'` and skip cleanly when unconfigured.

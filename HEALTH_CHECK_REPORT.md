# InsiderFlow Health Check & Resume Report

**Date:** 2026-10-11  
**Branch:** `chore/health-check-resume`  
**Verdict:** (Pending full verification — see final section)

---

## 1. Ground-Truth Deployment State

### Acceptance Statement

**Current Deployment State:** `never-deployed-and-scheduled-jobs-still-failing`.

Production infrastructure (Vercel web app, Cloudflare EDGAR worker) has **never been provisioned, linked, or deployed**. The daily GitHub Actions failure notification emails received by the user are **not** from a broken production deployment; they are caused solely by the scheduled `Supply chain` workflow failing on `pnpm audit` due to 7 newly disclosed CVE advisories.

### Verification Evidence

1. **GitHub CLI Auth:**
   - Command: `gh auth status`
   - Result: Logged in as `shAsh-cy` with scopes `gist, read:org, repo, workflow`.
2. **Repository Variable `DEPLOYMENT_ACTIVE`:**
   - Command: `gh variable list`
   - Result: Empty (0 variables). `DEPLOYMENT_ACTIVE` is unset.
3. **Failing Scheduled Workflows:**
   - Command: `gh run list --limit 30` and `gh run list --status=failure --limit 15`
   - Result:
     - Gated workflows (`Backfill`, `Supabase keep-alive`, `Ops`, `Nightly analytics`) all evaluate `vars.DEPLOYMENT_ACTIVE == 'true'` to false and complete with `skipped` (e.g. runs 38145781572, 38141078629, 38139992915).
     - **Only one distinct workflow is failing:** `Supply chain` (`.github/workflows/supply-chain.yml`), running on schedule.
4. **Log Inspection of 3 Most Recent Failures:**
   - Runs inspected: `38133489164` (2026-10-11), `38045649470` (2026-10-10), `37923287382` (2026-10-09).
   - Root Cause: `pnpm audit` fails with exit code 1 reporting 7 vulnerabilities (2 moderate, 3 high, 2 critical):
     - `GHSA-p293-qw3h-jr36` (Critical): Next.js Server Components RCE
     - `GHSA-2xp9-vwfh-vxw4` (Critical): Next.js Middleware / Route Cache RCE
     - `GHSA-rgj7-g3m4-5g8c` (High): sharp libheif vulnerability
     - `GHSA-68fv-2mgg-jv7q` (High): source-map-js event loop denial of service
     - `GHSA-wq5f-xc86-pv6w` (High): sharp librsvg vulnerability
     - `GHSA-4jqv-mc3x-m676` (Moderate): Next.js cache poisoning in SSG/ISR
     - `GHSA-mcj8-r9mp-w47p` (Moderate): Next.js cache poisoning in SSG/ISR
5. **Deployment Artifacts & Branch State:**
   - `.vercel/` directory does not exist.
   - `DEPLOYMENT_STATE.md` specifies Part 2 production deployment as "PAUSED, NOT STARTED".
   - `DEPLOY.md` only exists in unmerged branch `feat/r21-release-pipeline`, documenting that the release pipeline was never dispatched.

---

## 2. Supabase Post-Pause Verification

### Verification Table

| Check                            | Target / Endpoint                           | Status      | Evidence / Details                                                                                                                |
| -------------------------------- | ------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase Project Active**      | `https://iugwzzaexdbrdqtnibij.supabase.co`  | **PASS**    | HTTP 200 on `/auth/v1/health`: `GoTrue v2.197.0` responding; unpaused.                                                            |
| **Session Pooler (5432)**        | `aws-0-ap-south-1.pooler.supabase.com:5432` | **PASS**    | TCP test succeeded (`TcpTestSucceeded: True`, remote IP `65.0.195.55`).                                                           |
| **Transaction Pooler (6543)**    | `aws-0-ap-south-1.pooler.supabase.com:6543` | **PASS**    | TCP test succeeded (`TcpTestSucceeded: True`, remote IP `65.0.195.55`).                                                           |
| **Secondary Pooler (5432/6543)** | `aws-1-ap-south-1.pooler.supabase.com`      | **PASS**    | TCP test succeeded on both 5432 and 6543 (`13.200.110.68`).                                                                       |
| **Direct Host DNS**              | `db.iugwzzaexdbrdqtnibij.supabase.co`       | **PASS**    | Resolves AAAA `2406:da1a:82a:9d00:de46:a5d1:bbb6:6158` (AWS ap-south-1).                                                          |
| **Supabase Remote Credentials**  | `.env.production.local` / repo secrets      | **NOT SET** | Consistent with `DEPLOYMENT_STATE.md`: `.env.production.local` was never created; no migrations ever run against remote Supabase. |
| **RLS Isolation Proof (PGlite)** | `packages/db/src/rls.test.ts`               | **PASS**    | 13/13 tests pass. Unscoped query returns only caller rows, `FORCE RLS` verified.                                                  |
| **Scanner Scope Proof (PGlite)** | `packages/db/src/scanner-scope.test.ts`     | **PASS**    | 8/8 tests pass. Admin `withUserContextAsApp` scopes per-user with 0 leak.                                                         |

### RLS Verification Output (Verbatim from `pnpm --filter @insiderflow/db test`)

```console
$ vitest run
 RUN  v3.2.7 C:/Users/HP/insiderflow/packages/db

 ✓ src/synthetic-scope.test.ts (5 tests) 7918ms
 ✓ src/cluster-fallback.test.ts (5 tests) 7471ms
 ✓ src/rls.test.ts (13 tests) 1899ms
 ✓ src/scanner-scope.test.ts (8 tests) 1931ms

 Test Files  4 passed (4)
      Tests  31 passed (31)
   Duration  28.50s
```

_Note on Production DB row counts & `pnpm db:bootstrap -- --check`:_
Because production deployment was paused prior to Part 2 execution (`DEPLOYMENT_STATE.md`), the remote Supabase database has never had migrations applied to it (it remains an empty project used solely for Auth sessions per `docs/auth.md` decision (b)). Remote connection credentials (`.env.production.local`) have not been provided locally. The local Docker daemon (`com.docker.service`) is currently stopped on the host.

---

## 3. Diagnose and Fix Failing Scheduled Workflows

### Per-Workflow Diagnosis & Root Cause

| Workflow                                  | Schedule             | Failing / Skipping | Root Cause & Analysis                                                                                                                                                                                                                                                                                 | Fix / Status                                                                                                                                                                   |
| ----------------------------------------- | -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Supply chain** (`supply-chain.yml`)     | Daily `17 4 * * *`   | **FAILING**        | 7 vulnerabilities found by `pnpm audit --prod --audit-level=low` in `next` (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p), `sharp` (GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w), and `source-map-js` (GHSA-68fv-2mgg-jv7q). CodeQL action v3 deprecation warning. | **FIXED:** Upgraded Next.js to 15.5.27, sharp to ^0.35.5, source-map-js to ^1.2.2, undici to >=7.29.1, codeql-action to v4. `pnpm audit --prod` now reports 0 vulnerabilities. |
| **Backfill** (`backfill.yml`)             | Nightly `20 7 * * *` | **SKIPPED**        | Gated on `vars.DEPLOYMENT_ACTIVE == 'true'`. Variable is unset because production is not deployed.                                                                                                                                                                                                    | **VERIFIED:** Gating logic works as designed.                                                                                                                                  |
| **Supabase keep-alive** (`keepalive.yml`) | Every 3 days         | **SKIPPED**        | Gated on `vars.DEPLOYMENT_ACTIVE == 'true'`.                                                                                                                                                                                                                                                          | **VERIFIED:** Gating logic works as designed.                                                                                                                                  |
| **Ops** (`ops.yml`)                       | Hourly               | **SKIPPED**        | Gated on `vars.DEPLOYMENT_ACTIVE == 'true'`.                                                                                                                                                                                                                                                          | **VERIFIED:** Gating logic works as designed.                                                                                                                                  |
| **Nightly analytics** (`analytics.yml`)   | Nightly `0 4 * * *`  | **SKIPPED**        | Gated on `vars.DEPLOYMENT_ACTIVE == 'true'`.                                                                                                                                                                                                                                                          | **VERIFIED:** Gating logic works as designed.                                                                                                                                  |

### Upstream Service & Ingestion Endpoint Re-verification

1. **NSE India PIT Endpoint (`corporates-pit-gg`):**
   - Re-verified via live smoke probe: `ENABLE_INDIA_INGEST=true pnpm --filter @insiderflow/india-local smoke`.
   - Result:
     - `corporates-pit-gg` returned **50 rows** (live, schema matching `["appId", "broadcastDateTime", "companyName", "symbol", "xmlFileName", ...]`).
     - Control probe against retired path `corporates-pit` returned **0 rows** (confirming retirement status holds).
     - SAST returned 107 rows, Bulk deals returned 70 rows.
2. **SEC EDGAR Feed:**
   - Probed `https://www.sec.gov/cgi-bin/browse-edgar?...&type=4&...` with User-Agent `InsiderFlow/1.0 (research; contact@insiderflow.dev)`.
   - Result: HTTP 200 OK.
3. **Telegram Bot Token:**
   - Probed `https://api.telegram.org/bot<token>/getMe`.
   - Result: HTTP 200 OK (`@insiderflowsh_bot`, ID 8567204791).

---

## 4. Dependency + Security Drift Check

### Findings Summary

| Tool / Check                              | Scope                                         | Results                        | Notes / Mitigations                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`pnpm audit --prod --audit-level=low`** | Production dependencies                       | **0 vulnerabilities** (Clean)  | All 7 vulnerabilities in production (`next`, `sharp`, `source-map-js`) resolved.                                                                                                            |
| **`pnpm audit --audit-level=high`**       | Full dependency tree                          | **0 vulnerabilities** (Clean)  | `undici` upgraded to `>=7.29.1`, `tinypool` to `>=2.1.2`, `js-yaml` to `^4.3.2`, `brace-expansion` to `>=5.0.12`.                                                                           |
| **Gitleaks**                              | Full git history + working tree (167 commits) | **0 leaks found** (Clean)      | Scanned 167 commits against `.gitleaks.toml`. No secrets or committed credentials.                                                                                                          |
| **Client-bundle secret scanner**          | `node scripts/lint-client-bundle.mjs`         | **0 secrets found** (Clean)    | Scanned 94 client assets, 7 key shapes + JWT role claims; clean.                                                                                                                            |
| **Next.js Patch Releases**                | `apps/web`                                    | **Upgraded 15.5.23 → 15.5.27** | Patched 4 CVEs: GHSA-p293-qw3h-jr36 (RCE, Critical), GHSA-2xp9-vwfh-vxw4 (RCE, Critical), GHSA-4jqv-mc3x-m676 (Cache poisoning, Moderate), GHSA-mcj8-r9mp-w47p (Cache poisoning, Moderate). |

---

## 5. Full Suite + Gates Verification

### Static Gates & Linters

| Gate / Command             | Scope                  | Result   | Details                                                 |
| -------------------------- | ---------------------- | -------- | ------------------------------------------------------- |
| `pnpm typecheck`           | Monorepo (7 packages)  | **PASS** | 0 TypeScript errors.                                    |
| `pnpm lint`                | Monorepo (7 packages)  | **PASS** | 0 ESLint errors across all packages.                    |
| `pnpm format:check`        | All files              | **PASS** | "All matched files use Prettier code style!"            |
| `pnpm lint:scripts`        | `scripts/` directory   | **PASS** | 0 ESLint errors in scripts.                             |
| `pnpm lint:changelog`      | `CHANGELOG.md`         | **PASS** | 11 sections, 57 commits verified.                       |
| `pnpm lint:e2e-locators`   | `apps/web/e2e`         | **PASS** | 39 spec files, 0 class/id selectors outside allowances. |
| `pnpm lint:e2e-assertions` | `apps/web/e2e`         | **PASS** | 39 spec files, 1 justified status array.                |
| `pnpm lint:api-schemas`    | `apps/web/src/app/api` | **PASS** | 19 route files, 27 handlers, 37 self-tests verified.    |
| `pnpm lint:client-bundle`  | `.next/static`         | **PASS** | 94 client assets scanned, 0 secrets found.              |

### Unit & Integration Suite Results

Command: `pnpm test` (`pnpm -r --workspace-concurrency=1 test`)

| Package                     | Test Files | Passed  | Failed | Skipped | Duration    |
| --------------------------- | ---------- | ------- | ------ | ------- | ----------- |
| `@insiderflow/core`         | 12         | 269     | 0      | 0       | 2.69s       |
| `@insiderflow/db`           | 4          | 31      | 0      | 0       | 27.23s      |
| `@insiderflow/alerts`       | 3          | 75      | 0      | 0       | 53.39s      |
| `@insiderflow/web`          | 25         | 245     | 0      | 0       | 2.10s       |
| `@insiderflow/analytics`    | 1          | 18      | 0      | 0       | 23.08s      |
| `@insiderflow/edgar-worker` | 2          | 8       | 0      | 0       | 16.49s      |
| `@insiderflow/india-local`  | 2          | 7       | 0      | 0       | 5.02s       |
| **TOTAL**                   | **49**     | **653** | **0**  | **0**   | **~2m 10s** |

_Comparison vs baseline:_
The test count (653 passed across 49 files) matches the full unit/integration test footprint on this branch with 100% pass rate.

### E2E Suite & Lighthouse Status

- **Web Server Build (`next build`):** PASSED. Webpack/Next.js production build succeeded with no errors.
- **E2E Pre-flight Guard (`apps/web/e2e/global-setup.ts`):** Triggered cleanly:
  ```
  E2E PRE-FLIGHT FAILED — the database is unreachable
    `docker exec insiderflow-postgres psql` failed: Command failed
    Fix: start Docker Desktop, then `docker compose up -d postgres`.
    Not a product failure. No tests were run.
  ```
- **Root Cause:** The Docker Desktop Windows Service (`com.docker.service`) is stopped on the local machine and requires administrative privileges to start.
- **Lighthouse Runner:** Requires a running web server connected to Postgres. Mobile performance deficit on `/screener` remains documented in `README.md` and `docs/performance.md`.

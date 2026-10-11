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

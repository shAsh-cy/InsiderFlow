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

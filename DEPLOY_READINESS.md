# InsiderFlow Deployment Readiness & Open-Source Publication Report

**Date**: 2026-10-13  
**Repository**: `shAsh-cy/InsiderFlow`  
**License**: AGPL-3.0  
**Status**: Codebase GO for production deployment & open-source publication. Production infrastructure pending human provisioning.

---

## Executive Summary

Following the 2-month project hiatus and subsequent health check rounds (`HEALTH_CHECK_REPORT.md` and `HEALTH_CHECK_FOLLOWUP.md`), this session completed the merge of both `chore/health-check-followup` and `feat/r21-release-pipeline` into `main` (`8d415cd`).

All static analysis gates, unit tests (705/705 passing), supply chain audits, Gitleaks history scanning across all 175 commits, and workflow linting (`actionlint`) passed with zero errors. All required open-source governance documents (`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`), repository metadata, and 5 good-first-issues have been established on GitHub.

As mandated by design invariants: **No production infrastructure was touched, no deployment pipeline was dispatched, and repository visibility settings were not altered.** Live provisioning remains an explicit human task documented in `PROVISIONING_CHECKLIST.md`.

---

## Part A: Current Repository State & Scope Confirmation

### 1. Git Branch & Status

- **Current Branch**: `main`
- **Head Commit**: `8d415cd merge: r21 release pipeline and deployment automation`
- **Branch Lineage**:
  - `chore/health-check-followup` merged to `main` at `b97a6d3`
  - `feat/r21-release-pipeline` merged to `main` at `8d415cd`
- **Working Tree**: Clean.

### 2. Visibility & Repository Status

Query: `gh repo view --json isPrivate,visibility`

```json
{
  "isPrivate": false,
  "visibility": "PUBLIC"
}
```

_Note_: Repository visibility is already `PUBLIC`. Push protection and secret scanning are verified active.

### 3. Secret & Variable Inventory

- `gh variable list`: 0 variables configured.
- `gh secret list`: 0 repository secrets configured.
- `gh api repos/shAsh-cy/InsiderFlow/environments`: 0 environments configured.

### 4. Operational Boundaries Confirmation

This session is strictly **prepare-only**:

- Provisioning external accounts (Supabase, Vercel, Cloudflare, Telegram) requires personal human credentials and was not attempted.
- Setting GitHub environment secrets and approving the GitHub Environment gate requires human action.
- The pipeline (`pnpm deploy:prod`) was NOT dispatched.

---

## Part B: Merges, Verifications, and Pipeline Dry-Runs

### 5. Merges into `main` and Suite Verification

Both feature branches were cleanly merged into `main` using `--no-ff`.
Full verification on merged `main`:

- **Supply-Chain Security**:
  - `pnpm audit --prod`: **0 vulnerabilities** (clean).
- **TypeScript**:
  - `pnpm typecheck`: **All 7 packages passed** (0 errors).
- **Unit Test Suite**:
  - `pnpm test`: **53 test files passed, 705 unit tests passed, 0 failed**.
- **Static Lint & Quality Gates**:
  - `pnpm lint`: Pass.
  - `pnpm format:check`: Pass.
  - `pnpm lint:scripts`: Pass.
  - `pnpm lint:changelog`: Pass (23 sections, 141 commits validated).
  - `pnpm lint:changelog-quotes`: Pass (157 quotation fragments verified verbatim against commit history).
  - `pnpm lint:e2e-locators`: Pass.
  - `pnpm lint:e2e-assertions`: Pass.
  - `pnpm lint:api-schemas`: Pass.
  - `pnpm lint:client-bundle`: Pass.

---

### 6. Provisioning Checklist

Below is the complete content of [PROVISIONING_CHECKLIST.md](file:///c:/Users/HP/insiderflow/PROVISIONING_CHECKLIST.md) created for the human operator:

````markdown
# InsiderFlow Production Provisioning Checklist

This checklist is the literal, ordered, human-executable guide for provisioning all production infrastructure before running `pnpm deploy:prod` for the first time.

CRITICAL INVARIANT: Every action in this checklist is performed by a human operator in their own account dashboards or authenticated terminals. Automated agents must not execute live deployment or provision secrets.

---

## Phase 1: Supabase Production Project

### Step 1.1: Create Dedicated Production Project

- Where: Supabase Dashboard (https://supabase.com/dashboard) → New Project.
- Organization: Same organization as the dev project (keeps both projects within the single included Supabase tier).
- Project Name: insiderflow-prod (or your chosen production name).
- Database Password: Generate a high-entropy password (e.g., 32 random characters). Record it securely.
- Region: Choose the region closest to your Vercel deployment (e.g., us-east-1 / East US).
- Wait: Allow 1–2 minutes for provisioning to complete.

### Step 1.2: Retrieve Connection Strings and Keys

Navigate to Project Settings in the left sidebar:

1. Settings → Database → Connection string:
   - Select Connection pooling (Supavisor).
   - Mode: Session (Port 5432). Copy URI:
     postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
     (This is your admin migration string: fills DATABASE_URL).
   - Mode: Transaction (Port 6543). Copy URI:
     postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
     (Pooler host and port used to construct the app connection string below).
2. Settings → API:
   - Project URL: https://[PROJECT_REF].supabase.co (fills NEXT_PUBLIC_SUPABASE_URL).
   - Project API Keys: Copy anon / public key (fills NEXT_PUBLIC_SUPABASE_ANON_KEY).
   - WARNING: NEVER expose or copy the service_role key into client variables or Vercel NEXT_PUBLIC_* settings.

---

## Phase 2: Database App Role & RLS Verification

The production web app connects as insiderflow_app (NOBYPASSRLS), ensuring PostgreSQL row-level security is strictly enforced on all user tables.

### Step 2.1: Generate App Role Password

In your local terminal, generate a random 24-byte secret:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```
````

Record this value as `APP_DB_PASSWORD`.

### Step 2.2: Create the insiderflow_app Role

Run the app role creation script targeting the production admin session pooler:

```bash
$env:DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
$env:APP_DB_PASSWORD="<generated-password>"
pnpm db:app-role
```

- Assertion: Script confirms role `insiderflow_app` created with `NOBYPASSRLS` and granted table permissions.
- Construct App Connection String:
  In Supabase Supavisor, pooled connections for custom roles require username format `[ROLE].[PROJECT_REF]`.
  Format:
  ```
  postgresql://insiderflow_app.[PROJECT_REF]:<APP_DB_PASSWORD>@aws-0-[REGION].pooler.supabase.com:6543/postgres
  ```
  (This is your transaction pooler string: fills APP_DATABASE_URL).

### Step 2.3: Verify RLS Enforcement

Test that the newly configured role satisfies the RLS gate:

```bash
$env:DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
$env:APP_DATABASE_URL="postgresql://insiderflow_app.[PROJECT_REF]:<APP_DB_PASSWORD>@aws-0-[REGION].pooler.supabase.com:6543/postgres"
pnpm db:bootstrap -- --check
```

- Expected Output:
  - anon / unauthenticated context: 0 rows returned.
  - Owner context: 1 row returned.
  - Cross-user context: 0 rows returned.
  - Result: RLS ENFORCED AND PROVEN.

---

## Phase 3: Supabase Authentication & Attack Protection

Navigate to Authentication in the Supabase Dashboard:

### Step 3.1: Cloudflare Turnstile Configuration

1. Obtain Cloudflare Turnstile keys (from Cloudflare Dashboard → Turnstile → Add Site):
   - Domain: your production domain (e.g. insiderflow.vercel.app or custom domain).
   - Mode: Managed.
   - Outputs: Site Key (NEXT_PUBLIC_TURNSTILE_SITE_KEY) and Secret Key.
2. In Supabase Dashboard:
   - Navigate to Authentication → Attack Protection.
   - Under Bot Protection (CAPTCHA): Select Cloudflare Turnstile.
   - Enter your Cloudflare Turnstile Secret Key. Click Save.

### Step 3.2: Production Email Provider Decision

Navigate to Authentication → Providers → Email:
You have two deliberate choices for production:

- OPTION A (Recommended Default): OFF entirely
  - Setting: Toggle "Enable email provider" to OFF.
  - Reasoning: Completely eliminates phishing, credential stuffing, password resets, and account takeover surfaces. Sign-in operates via GitHub OAuth only.
  - Verification: `.\scripts\verify-windows.ps1 -EmailProvider off` expects signup/login attempts to be rejected as unsupported.

- OPTION B: ON with Magic Links Only (Password disabled)
  - Setting: Toggle "Enable email provider" to ON, but ensure password signup is never presented.
  - Control: apps/web/e2e/auth-providers.spec.ts verifies that no password input element, name, autocomplete, or copy exists.
  - Verification: `.\scripts\verify-windows.ps1 -EmailProvider magic-link` expects requests to be challenged by Turnstile CAPTCHA.

### Step 3.3: Confirm Email Setting

- Navigate to Authentication → Providers → Email.
- Ensure Confirm email is set to ON (enabled).

### Step 3.4: URL Configuration

Navigate to Authentication → URL Configuration:

- Site URL: https://<your-production-origin>
- Redirect URLs: Add https://<your-production-origin>/auth/callback. Keep http://localhost:3000/auth/callback for local development.

---

## Phase 4: Production Telegram Bot

1. Open Telegram and search for @BotFather.
2. Send `/newbot`.
3. Provide name: `InsiderFlow Prod Alerts`.
4. Provide unique username: e.g. `insiderflow_prod_bot`.
5. BotFather will provide an HTTP API bot token: `1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ`.
   - Record as `TELEGRAM_BOT_TOKEN`.
   - Record username as `TELEGRAM_BOT_USERNAME`.
6. Generate a random webhook secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   - Record as `TELEGRAM_WEBHOOK_SECRET`.
7. Obtain your personal Chat ID (or team ops channel ID) using @userinfobot or Bot API `/getUpdates`:
   - Record as `OPS_TELEGRAM_CHAT_ID`.

---

## Phase 5: Vercel Project Setup

### Step 5.1: Create Project

1. Go to Vercel Dashboard (https://vercel.com/new).
2. Import repository `shAsh-cy/InsiderFlow`.
3. Under Project Settings:
   - Root Directory: Click Edit, select `apps/web`. (CRITICAL: monorepo builds fail if root is repo root).
   - Framework Preset: Next.js.
   - Do not trigger immediate deployment yet.

### Step 5.2: Retrieve Vercel Identifiers

1. VERCEL_TOKEN: Go to Vercel Account Settings → Tokens → Create token `insiderflow-deploy`.
2. In project dashboard:
   - Navigate to Settings → General.
   - Copy Project ID (`VERCEL_PROJECT_ID`).
   - Copy Organization ID (`VERCEL_ORG_ID`).

### Step 5.3: Configure Production Environment Variables in Vercel

Go to Settings → Environment Variables. Add the following with Target = Production:

- `DEPLOY_ENV` = `production`
- `APP_DATABASE_URL` = `postgresql://insiderflow_app.[REF]:<PW>@aws-0-[REG].pooler.supabase.com:6543/postgres`
- `NEXT_PUBLIC_SUPABASE_URL` = `https://[PROJECT_REF].supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<supabase-anon-key>`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = `<cloudflare-site-key>`
- `SITE_URL` = `https://<your-vercel-domain>`
- `TELEGRAM_BOT_TOKEN` = `<production-bot-token>`
- `TELEGRAM_BOT_USERNAME` = `<production-bot-username>`
- `TELEGRAM_WEBHOOK_SECRET` = `<generated-32-byte-hex>`

---

## Phase 6: Cloudflare Workers Setup

### Step 6.1: Retrieve Account ID and API Token

1. Go to Cloudflare Dashboard.
2. In right sidebar, copy Account ID (`CLOUDFLARE_ACCOUNT_ID`).
3. Navigate to My Profile → API Tokens → Create Token:
   - Template: Edit Cloudflare Workers.
   - Permissions: Account - Worker Scripts: Edit.
   - Copy token: `CLOUDFLARE_API_TOKEN`.

### Step 6.2: Set Worker Secrets

From repository root in local shell:

```bash
cd ingestion/edgar-worker
pnpm wrangler secret put DATABASE_URL
pnpm wrangler secret put EDGAR_USER_AGENT
pnpm wrangler secret put SITE_URL
pnpm wrangler secret put TELEGRAM_BOT_TOKEN
cd ../..
```

---

## Phase 7: GitHub Environment & Secret Inventory

### Step 7.1: Create GitHub Environment

1. In repository: Settings → Environments → New environment.
2. Name: `production`.
3. Check Required reviewers → Add your GitHub user account.
4. Click Save protection rules.

### Step 7.2: Generate Deployment PAT (`DEPLOY_PAT`)

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Repository access: Only `shAsh-cy/InsiderFlow`.
3. Permissions: Repository permissions → Variables: Read and Write.
4. Generate and copy token (`DEPLOY_PAT`).

### Step 7.3: Set GitHub Environment Secrets

Run via GitHub CLI:

```bash
gh secret set DATABASE_URL --env production --body "postgresql://postgres.[REF]:[PW]@aws-0-[REG].pooler.supabase.com:5432/postgres"
gh secret set APP_DATABASE_URL --env production --body "postgresql://insiderflow_app.[REF]:<PW>@aws-0-[REG].pooler.supabase.com:6543/postgres"
gh secret set APP_DB_PASSWORD --env production --body "<generated-app-db-password>"
gh secret set VERCEL_TOKEN --env production --body "<vercel-token>"
gh secret set VERCEL_ORG_ID --env production --body "<vercel-org-id>"
gh secret set VERCEL_PROJECT_ID --env production --body "<vercel-project-id>"
gh secret set CLOUDFLARE_API_TOKEN --env production --body "<cloudflare-api-token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --body "<cloudflare-account-id>"
gh secret set SITE_URL --env production --body "https://<your-vercel-domain>"
gh secret set DEPLOY_PAT --env production --body "<generated-deploy-pat>"
```

### Step 7.4: Set GitHub Repository Secrets

```bash
gh secret set DATABASE_URL --body "postgresql://postgres.[REF]:[PW]@aws-0-[REG].pooler.supabase.com:5432/postgres"
gh secret set EDGAR_USER_AGENT --body "InsiderFlow-Ingest/1.0 (contact@yourdomain.com)"
gh secret set TELEGRAM_BOT_TOKEN --body "<production-bot-token>"
gh secret set OPS_TELEGRAM_CHAT_ID --body "<ops-chat-id>"
gh secret set SITE_URL --body "https://<your-vercel-domain>"
```

---

## Phase 8: Verification Before Deploy

Before initiating `pnpm deploy:prod`:

1. Verify `gh secret list --env production` reports all 10 environment secrets.
2. Verify `gh secret list` reports all 5 repository secrets.
3. Verify `vercel env ls production` inside `apps/web` lists all required variables.
4. Run Windows verification check on local workstation:
   ```powershell
   .\scripts\verify-windows.ps1 `
     -BaseUrl https://<your-vercel-domain> `
     -SupabaseUrl https://[PROJECT_REF].supabase.co `
     -SupabaseAnonKey <anon-key> `
     -EmailProvider off
   ```

````

---

### 7. Verbatim Workflow YAML: RLS Enforcement Gate

Verification of `.github/workflows/release.yml` (lines 260–281):
The pipeline runs `pnpm db:bootstrap -- --check`, tees output to `rls-check.log`, checks for exact failure strings (`rls_not_enforced`, `rls_not_proven`, `rls_over_restrictive`), and hard-aborts if non-zero or failure strings are matched:

```yaml
      - name: Prove RLS enforcement against production
        id: rls
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          APP_DATABASE_URL: ${{ secrets.APP_DATABASE_URL }}
        run: |
          echo "::group::Proving RLS with insiderflow_app..."
          # db:bootstrap -- --check connects as APP_DATABASE_URL and
          # verifies:
          #   1. unauthenticated query -> 0 rows
          #   2. user A query with user A context -> sees only user A
          #   3. user A query with user B context -> 0 rows
          #   4. app role cannot bypass RLS
          # Fails with non-zero exit code on any violation.
          set -o pipefail
          pnpm db:bootstrap -- --check 2>&1 | tee rls-check.log
          CHECK_STATUS=${PIPESTATUS[0]}
          if [ $CHECK_STATUS -ne 0 ] || grep -qE "rls_not_enforced|rls_not_proven|rls_over_restrictive" rls-check.log; then
            echo "::error::RLS check failed against production database"
            echo "::error::The application role MUST NOT be able to bypass RLS"
            exit 1
          fi
          echo "RLS enforcement proven against production"
          echo "::endgroup::"
````

---

### 8. Verbatim Workflow YAML: Migration Session Pooler Gate

Verification of `.github/workflows/release.yml` (lines 210–219):
The pipeline asserts that migrations target the session pooler (port 5432) and outright rejects port 6543 (transaction pooler). Since 2025-02-28, Supabase port 6543 operates in transaction mode only; attempting `drizzle-kit migrate` against 6543 causes it to hang indefinitely.

```yaml
- name: Assert session pooler for migrations
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: |
    # Fails immediately if DATABASE_URL points at port 6543 (transaction pooler).
    # Migrations require port 5432 (session pooler) because Drizzle/pg
    # uses session-level locks and queries.
    node scripts/assert-session-pooler.mjs DATABASE_URL

- name: Run database migrations
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: pnpm db:migrate
```

---

### 9. Pipeline Dry-Runs & Assertion Results

All dry-runnable scripts and guardrails were executed on the system:

| Target                                 | Command                                                       | Result   | Details                                                                                                                  |
| :------------------------------------- | :------------------------------------------------------------ | :------- | :----------------------------------------------------------------------------------------------------------------------- |
| **Workflow Linter**                    | `actionlint .github/workflows/*.yml`                          | **PASS** | Evaluated all 8 workflow files; 0 syntax or context errors.                                                              |
| **Deploy Guardrails**                  | `node scripts/deploy-prod.mjs`                                | **PASS** | Validated CLI installation, clean git tree checks, branch check, prompted confirmation, exited cleanly on 'n'.           |
| **Worker Cron Assert**                 | `node scripts/assert-worker-crons.mjs`                        | **PASS** | Verified crons `* * * * *` and `0 * * * *` match wrangler budget (2 of 5 triggers used).                                 |
| **Session Pooler Assert (Rejection)**  | `node scripts/assert-session-pooler.mjs TEST_URL` (port 6543) | **PASS** | Correctly threw error: `refuses transaction pooler (port 6543) ... Migrations on 6543 hang indefinitely`. Exited code 1. |
| **Session Pooler Assert (Acceptance)** | `node scripts/assert-session-pooler.mjs TEST_URL` (port 5432) | **PASS** | Successfully verified valid session pooler host and port. Exited code 0.                                                 |

---

## Part C: Open-Source Publication Preparation

### 10. Final Secret Sweep & Scanning Protection

1. **Gitleaks Scan**: Installed Gitleaks v8.30.1. Executed:
   ```bash
   gitleaks detect --source=. --verbose --redact
   ```
   Scanned full repository history across all 175 commits. **Result: 0 leaks found.**
2. **GitHub Push Protection & Secret Scanning**: Verified enabled via GitHub REST API:
   - `secret_scanning: { status: "enabled" }`
   - `secret_scanning_push_protection: { status: "enabled" }`

### 11. README Inspection & Verification

[README.md](file:///c:/Users/HP/insiderflow/README.md) verified against strict standards:

- **One-Command Local Quickstart**: Tested and verified using Docker Compose (`docker compose up`).
- **Honest Comparison Table**: Includes named competitors (OpenInsider, SecForm4, InsiderScreener, Finviz Elite, Unusual Whales, Quiver Quantitative, VerityData, 2iQ, Trendlyne/StockEdge).
- **"Where InsiderFlow is behind" Section**: Explicitly documents:
  - No options flow and no dark-pool data (core feature of Unusual Whales).
  - Congressional disclosures upstream bucket is dead (HTTP 403 on S3).
  - India NSE/BSE is self-host only due to exchange redistribution licensing restrictions.
  - No global multi-country coverage (EU MAR and SEDI are normalizer stubs).
  - No five-year curated analyst rankings.
  - No 13D/G or 13F institutional ownership tracking.
  - Production not yet deployed.
- **Known Defects**: Clearly lists the SSE cursor microsecond truncation issue, NSE bulk deals date boundary behavior, and Lighthouse mobile CLS investigation.
- **No Unverifiable Superlatives**: Removed claims of "fastest", "most accurate", or unsupported latency SLAs.

### 12. Community Governance & Good First Issues

- **Code of Conduct**: Created [CODE_OF_CONDUCT.md](file:///c:/Users/HP/insiderflow/CODE_OF_CONDUCT.md) following Contributor Covenant v2.1.
- **Contributing Guide**: Updated [CONTRIBUTING.md](file:///c:/Users/HP/insiderflow/CONTRIBUTING.md) to reference Code of Conduct and correct clone URLs.
- **Good First Issues**: Opened 5 real, actionable good-first-issues on GitHub tracker:
  1. [#4](https://github.com/shAsh-cy/InsiderFlow/issues/4): _Fix SSE cursor millisecond/microsecond mismatch in fetchSince_
  2. [#5](https://github.com/shAsh-cy/InsiderFlow/issues/5): _Implement client-side date boundary filtering for NSE bulk deals and pledges_
  3. [#6](https://github.com/shAsh-cy/InsiderFlow/issues/6): _Add alternative open-source congressional PTR data source fallback_
  4. [#7](https://github.com/shAsh-cy/InsiderFlow/issues/7): _Enhance RSS 2.0 XML feeds with rich trade summary and CDATA escaping_
  5. [#8](https://github.com/shAsh-cy/InsiderFlow/issues/8): _Render mathematical formulas in /docs/methodology with KaTeX_

### 13. Discoverability & Metadata

Configured repository description and 10 search topics:

- **Description**: _"Real-time, multi-market insider trading tracker (SEC EDGAR Forms 3/4/5, Congress, NSE/BSE) with anomaly detection and automated alerts."_
- **Topics**: `cloudflare-workers`, `finance`, `fintech`, `insider-trading`, `nextjs`, `open-source`, `sec-edgar`, `stock-market`, `supabase`, `typescript`.

---

## Part D: Next Actions for Human Operator

The agent has completed all preparatory, verification, and governance tasks. Do NOT dispatch the pipeline or attempt to automate cloud provisioning.

The exact 3-step sequence the human operator must execute next:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HUMAN OPERATOR SEQUENCE                         │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Complete PROVISIONING_CHECKLIST.md personally:                      │
│    - Create production Supabase project                                │
│    - Run `pnpm db:app-role` & verify RLS with `pnpm db:bootstrap`      │
│    - Set Turnstile secret in Supabase & choose Email Provider setting  │
│    - Create fresh Telegram Bot (@BotFather)                           │
│    - Create Vercel project (Root: apps/web) with DEPLOY_ENV=production │
│    - Create Cloudflare Worker tokens & set wrangler secrets            │
│    - Create GitHub `production` Environment & set all 15 secrets       │
│                                                                        │
│ 2. Run the deployment command & approve the gate:                      │
│    - In terminal: `pnpm deploy:prod`                                   │
│    - Open GitHub Actions run → review `production` environment approval │
│    - Click "Approve and deploy"                                        │
│                                                                        │
│ 3. Once production is confirmed live and smoke-tested:                 │
│    - Run `.\scripts\verify-windows.ps1` locally                        │
│    - Confirm public status and announce open-source release            │
└────────────────────────────────────────────────────────────────────────┘
```

# InsiderFlow Production Provisioning Checklist

This checklist is the literal, ordered, human-executable guide for provisioning all production infrastructure before running `pnpm deploy:prod` for the first time.

**CRITICAL INVARIANT:** Every action in this checklist is performed by a human operator in their own account dashboards or authenticated terminals. Automated agents must not execute live deployment or provision secrets.

---

## Overview of Target Architecture & Secrets

Secrets and configuration are segregated across four locations based on where the consuming runtime executes:

1. **GitHub Environment Secrets (`production`)**: Used only during deployment (`.github/workflows/release.yml`) after required human review.
2. **GitHub Repository Secrets**: Used by unattended scheduled maintenance workflows (`analytics.yml`, `ops.yml`, `backfill.yml`, `keepalive.yml`).
3. **Vercel Production Environment Variables**: Consumed by Next.js edge and serverless runtimes.
4. **Cloudflare Worker Secrets**: Consumed by `@insiderflow/edgar-worker` cron jobs.

---

## Phase 1: Supabase Production Project

### Step 1.1: Create Dedicated Production Project

- **Where**: [Supabase Dashboard](https://supabase.com/dashboard) → **New Project**.
- **Organization**: Same organization as the dev project (keeps both projects within the single included Supabase tier).
- **Project Name**: `insiderflow-prod` (or your chosen production name).
- **Database Password**: Generate a high-entropy password (e.g., 32 random characters). Record it securely.
- **Region**: Choose the region closest to your Vercel deployment (e.g., `us-east-1` / `East US`).
- **Wait**: Allow 1–2 minutes for provisioning to complete.

### Step 1.2: Retrieve Connection Strings and Keys

Navigate to **Project Settings** in the left sidebar:

1. **Settings → Database → Connection string**:
   - Select **Connection pooling** (Supavisor).
   - Mode: **Session** (Port `5432`). Copy URI:
     `postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres`
     _(This is your admin migration string: fills `DATABASE_URL`)_.
   - Mode: **Transaction** (Port `6543`). Copy URI:
     `postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`
     _(Pooler host and port used to construct the app connection string below)_.
2. **Settings → API**:
   - **Project URL**: `https://[PROJECT_REF].supabase.co` _(fills `NEXT_PUBLIC_SUPABASE_URL`)_.
   - **Project API Keys**: Copy `anon` / `public` key _(fills `NEXT_PUBLIC_SUPABASE_ANON_KEY`)_.
   - ⚠️ **NEVER** expose or copy the `service_role` key into client variables or Vercel `NEXT_PUBLIC_*` settings.

---

## Phase 2: Database App Role & RLS Verification

The production web app connects as `insiderflow_app` (`NOBYPASSRLS`), ensuring PostgreSQL row-level security is strictly enforced on all user tables.

### Step 2.1: Generate App Role Password

In your local terminal, generate a random 24-byte secret:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Record this value as `APP_DB_PASSWORD`.

### Step 2.2: Create the `insiderflow_app` Role

Run the app role creation script targeting the production admin session pooler:

```bash
$env:DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
$env:APP_DB_PASSWORD="<generated-password>"
pnpm db:app-role
```

- **Assertion**: Script confirms role `insiderflow_app` created with `NOBYPASSRLS` and granted table permissions.
- **Construct App Connection String**:
  In Supabase Supavisor, pooled connections for custom roles require username format `[ROLE].[PROJECT_REF]`.
  Format:
  ```
  postgresql://insiderflow_app.[PROJECT_REF]:<APP_DB_PASSWORD>@aws-0-[REGION].pooler.supabase.com:6543/postgres
  ```
  _(This is your transaction pooler string: fills `APP_DATABASE_URL`)_.

### Step 2.3: Verify RLS Enforcement

Test that the newly configured role satisfies the RLS gate:

```bash
$env:DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
$env:APP_DATABASE_URL="postgresql://insiderflow_app.[PROJECT_REF]:<APP_DB_PASSWORD>@aws-0-[REGION].pooler.supabase.com:6543/postgres"
pnpm db:bootstrap -- --check
```

- **Expected Output**:
  - `anon` / unauthenticated context: 0 rows returned.
  - Owner context: 1 row returned.
  - Cross-user context: 0 rows returned.
  - Result: **RLS ENFORCED AND PROVEN**.

---

## Phase 3: Supabase Authentication & Attack Protection

Navigate to **Authentication** in the Supabase Dashboard:

### Step 3.1: Cloudflare Turnstile Configuration

1. Obtain Cloudflare Turnstile keys (from [Cloudflare Dashboard](https://dash.cloudflare.com) → **Turnstile** → **Add Site**):
   - Domain: your production domain (e.g. `insiderflow.vercel.app` or custom domain).
   - Mode: Managed.
   - Outputs: **Site Key** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) and **Secret Key**.
2. In Supabase Dashboard:
   - Navigate to **Authentication → Attack Protection**.
   - Under **Bot Protection (CAPTCHA)**: Select **Cloudflare Turnstile**.
   - Enter your Cloudflare Turnstile **Secret Key**. Click **Save**.

### Step 3.2: Production Email Provider Decision

Navigate to **Authentication → Providers → Email**:
You have two deliberate choices for production:

- **OPTION A (Recommended Default): OFF entirely**
  - **Setting**: Toggle "Enable email provider" to **OFF**.
  - **Reasoning**: Completely eliminates phishing, credential stuffing, password resets, and account takeover surfaces. Sign-in operates via GitHub OAuth only.
  - **Verification**: `.\scripts\verify-windows.ps1 -EmailProvider off` expects signup/login attempts to be rejected as unsupported.

- **OPTION B: ON with Magic Links Only (Password disabled)**
  - **Setting**: Toggle "Enable email provider" to **ON**, but ensure password signup is never presented.
  - **Control**: `apps/web/e2e/auth-providers.spec.ts` verifies that no password input element, name, autocomplete, or copy exists.
  - **Verification**: `.\scripts\verify-windows.ps1 -EmailProvider magic-link` expects requests to be challenged by Turnstile CAPTCHA.

### Step 3.3: Confirm Email Setting

- Navigate to **Authentication → Providers → Email**.
- Ensure **Confirm email** is set to **ON** (enabled).
- _(Note: Dev leaves this OFF for fast test user creation; production MUST have it ON)._

### Step 3.4: URL Configuration

Navigate to **Authentication → URL Configuration**:

- **Site URL**: `https://<your-production-origin>` (e.g. `https://insiderflow.vercel.app`).
- **Redirect URLs**: Add `https://<your-production-origin>/auth/callback`. Keep `http://localhost:3000/auth/callback` for local development.

---

## Phase 4: Production Telegram Bot

Production requires a dedicated, pristine Telegram Bot. Never reuse tokens used in local testing or group chats.

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Provide a name: `InsiderFlow Prod Alerts`.
4. Provide a unique username: e.g. `insiderflow_prod_bot`.
5. BotFather will provide an HTTP API bot token: `1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ`.
   - Record as `TELEGRAM_BOT_TOKEN`.
   - Record username as `TELEGRAM_BOT_USERNAME`.
6. Generate a random webhook secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   - Record as `TELEGRAM_WEBHOOK_SECRET`.
7. Obtain your personal Chat ID (or team ops channel ID) using [@userinfobot](https://t.me/userinfobot) or Bot API `/getUpdates`:
   - Record as `OPS_TELEGRAM_CHAT_ID`.

---

## Phase 5: Vercel Project Setup

### Step 5.1: Create Project

1. Go to [Vercel Dashboard](https://vercel.com/new).
2. Import repository `shAsh-cy/InsiderFlow`.
3. Under **Project Settings**:
   - **Root Directory**: Click Edit, select `apps/web`. _(CRITICAL: Pipeline cannot build if Root Directory is repo root)._
   - **Framework Preset**: Next.js.
   - Do not trigger immediate deployment yet.

### Step 5.2: Retrieve Vercel Identifiers

1. **VERCEL_TOKEN**: Go to [Vercel Account Settings → Tokens](https://vercel.com/account/tokens) → Create token `insiderflow-deploy` with Scope Full Account or Project.
2. In the project dashboard:
   - Navigate to **Settings → General**.
   - Copy **Project ID** (`VERCEL_PROJECT_ID`).
   - Copy **Organization ID** / Team ID (`VERCEL_ORG_ID`).

### Step 5.3: Configure Production Environment Variables in Vercel

Go to **Settings → Environment Variables**. Add the following with Target = **Production**:

| Name                             | Value                                                                                   | Purpose                                               |
| :------------------------------- | :-------------------------------------------------------------------------------------- | :---------------------------------------------------- |
| `DEPLOY_ENV`                     | `production`                                                                            | **Load-bearing.** Arms RLS fail-closed runtime checks |
| `APP_DATABASE_URL`               | `postgresql://insiderflow_app.[REF]:<PW>@aws-0-[REG].pooler.supabase.com:6543/postgres` | Transaction pooler on port 6543                       |
| `NEXT_PUBLIC_SUPABASE_URL`       | `https://[PROJECT_REF].supabase.co`                                                     | Public Supabase API endpoint                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | `<supabase-anon-key>`                                                                   | Public client API key                                 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `<cloudflare-site-key>`                                                                 | Public Turnstile widget key                           |
| `SITE_URL`                       | `https://<your-vercel-domain>`                                                          | CSRF allowlist and canonical URLs                     |
| `TELEGRAM_BOT_TOKEN`             | `<production-bot-token>`                                                                | Telegram webhook handler                              |
| `TELEGRAM_BOT_USERNAME`          | `<production-bot-username>`                                                             | Telegram deep links                                   |
| `TELEGRAM_WEBHOOK_SECRET`        | `<generated-32-byte-hex>`                                                               | Webhook signature verification                        |

---

## Phase 6: Cloudflare Workers Setup

### Step 6.1: Retrieve Account ID and API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. In the right sidebar, copy your **Account ID** (`CLOUDFLARE_ACCOUNT_ID`).
3. Navigate to **My Profile → API Tokens → Create Token**:
   - Template: **Edit Cloudflare Workers**.
   - Permissions: `Account - Worker Scripts: Edit`.
   - Copy token: `CLOUDFLARE_API_TOKEN`.

### Step 6.2: Set Worker Secrets

From repository root in local shell, configure the worker secrets:

```bash
cd ingestion/edgar-worker
pnpm wrangler secret put DATABASE_URL
# Paste transaction pooler URL (port 6543): postgresql://postgres.[REF]:[PW]@aws-0-[REG].pooler.supabase.com:6543/postgres

pnpm wrangler secret put EDGAR_USER_AGENT
# Paste descriptive contact string: "InsiderFlow-Ingest/1.0 (contact@yourdomain.com)"

pnpm wrangler secret put SITE_URL
# Paste https://<your-vercel-domain>

pnpm wrangler secret put TELEGRAM_BOT_TOKEN
# Paste <production-bot-token>
cd ../..
```

---

## Phase 7: GitHub Environment & Secret Inventory

### Step 7.1: Create GitHub Environment

1. In repository: **Settings → Environments → New environment**.
2. Name: `production`.
3. Check **Required reviewers** → Add your GitHub user account.
4. Click **Save protection rules**.

### Step 7.2: Generate Deployment PAT (`DEPLOY_PAT`)

Create a personal access token to allow the release workflow to update repository variables:

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Repository access: Only `shAsh-cy/InsiderFlow`.
3. Permissions: **Repository permissions → Variables: Read and Write**.
4. Generate and copy token (`DEPLOY_PAT`).

### Step 7.3: Set GitHub Environment Secrets

Run the following commands using GitHub CLI:

```bash
# Environment secrets (gated behind human approval)
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

These secrets feed the scheduled jobs (`analytics.yml`, `ops.yml`, `backfill.yml`, `keepalive.yml`):

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
3. Verify `vercel env ls production` inside `apps/web` lists `DEPLOY_ENV`, `APP_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Run Windows verification check on local workstation:
   ```powershell
   .\scripts\verify-windows.ps1 `
     -BaseUrl https://<your-vercel-domain> `
     -SupabaseUrl https://[PROJECT_REF].supabase.co `
     -SupabaseAnonKey <anon-key> `
     -EmailProvider off
   ```

When all items in this checklist are checked, you are ready to execute `pnpm deploy:prod`.

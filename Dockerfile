# Multi-stage build for the local Docker stack (docker-compose.yml).
#
# Production does NOT use this: apps/web deploys to Vercel and the ingestion
# pipeline runs as a Cloudflare Worker. This exists so `docker compose up`
# gives a contributor the whole product on one machine, and so the "run it on
# a small VPS" path in SCALING.md has something to build.
#
# NOTE: node_modules is never copied between stages. pnpm builds a symlink farm
# into a content-addressed store, and `COPY --from` does not reliably preserve
# it — the resulting image fails with "cannot find module" on packages that are
# plainly installed. Each stage that needs dependencies runs `pnpm install`
# itself; the shared store cache mount makes the repeat cheap.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
# Manifests first, so editing source does not re-resolve the dependency graph.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/alerts/package.json ./packages/alerts/
COPY packages/analytics/package.json ./packages/analytics/
COPY ingestion/edgar-worker/package.json ./ingestion/edgar-worker/
COPY ingestion/india-local/package.json ./ingestion/india-local/
# --ignore-scripts: husky's `prepare` hook needs a git repo, which .dockerignore
# deliberately excludes from the build context.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── Runner: migrations, seeding, scripts, the ingest loop ───────────────────
# Workspace packages ship TypeScript and run through tsx, so there is no build
# step for them.
FROM deps AS runner
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
ENV NODE_ENV=development
CMD ["node", "--version"]

# ── Web ─────────────────────────────────────────────────────────────────────
# `next build` never opens a connection — getDb() is called at request time —
# so no database is needed here.
FROM runner AS web
# MUST be set BEFORE the build, not after. Building with NODE_ENV=development
# (inherited from `runner`, which needs dev dependencies for tsx) makes Next
# fail while prerendering the error page with the misleading
# "<Html> should not be imported outside of pages/_document".
ENV NODE_ENV=production

# NEXT_PUBLIC_* must be present at BUILD time, not just at run time.
#
# Server code reads process.env at request time, so setting these only with
# `docker run -e` does give a working session layer — which is why the API
# behaves correctly and hides the problem. The BROWSER bundle is different:
# Next resolves these when it compiles the client chunks, so a runtime-only
# value produces a page whose server render says "auth is configured" and
# whose hydrated render says it is not. The sign-in button appears and then
# vanishes. docker-compose feeds the same two variables to `build.args` and to
# `environment` so the two halves cannot disagree.
#
# Neither is a secret: the anon key is public by design and is safe to bake
# into an image (docs/security.md). Both default to empty, which is the
# supported "public, read-only, no sign-in chrome" mode.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN pnpm --filter @insiderflow/web build
EXPOSE 3000
# `pnpm exec next` rather than `pnpm --filter web start -- -p 3000`: pnpm's
# script-argument forwarding is inconsistent between the implicit and `run`
# forms, and the `--` ends up reaching `next start` as a directory path
# ("Invalid project directory provided: /app/apps/web/-p"). Invoking the
# binary directly removes the ambiguity.
WORKDIR /app/apps/web
CMD ["pnpm", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]

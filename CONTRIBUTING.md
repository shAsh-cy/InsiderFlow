# Contributing to InsiderFlow

Thanks for helping build an open, transparent view of insider trading. This guide covers local
setup and the conventions we use.

## Prerequisites

- Node.js >= 20
- pnpm 10 (`npm i -g pnpm@latest-10`)
- Docker (optional, for local Postgres)

## Local setup

```bash
git clone https://github.com/<you>/insiderflow.git
cd insiderflow
pnpm install

# environment
cp .env.example .env                                            # fill in as needed
cp ingestion/edgar-worker/.dev.vars.example ingestion/edgar-worker/.dev.vars

# local database
docker compose up -d
pnpm db:migrate       # apply migrations (includes the pg_trgm extension)

# run the web app
pnpm dev              # http://localhost:3000

# run the ingestion worker locally
pnpm --filter @insiderflow/edgar-worker dev
```

## Repo layout

| Path                     | What lives there                                    |
| ------------------------ | --------------------------------------------------- |
| `apps/web`               | Next.js 15 app (App Router, RSC, Tailwind)          |
| `packages/core`          | Shared types, normalization, transaction-code enums |
| `packages/db`            | Drizzle schema + Postgres client                    |
| `ingestion/edgar-worker` | Cloudflare Worker polling SEC EDGAR on a cron       |

## Before you open a PR

CI runs all of these; save yourself a round trip:

```bash
pnpm typecheck
pnpm lint
pnpm format:check   # or `pnpm format` to fix
pnpm test
pnpm build
```

E2E tests are optional locally (`pnpm exec playwright install chromium` once, then
`pnpm test:e2e`).

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) preferred
  (`feat:`, `fix:`, `docs:`, `chore:`...). A Husky pre-commit hook formats staged files.
- **Code style**: Prettier + ESLint are the source of truth; do not hand-format against them.
- **Types**: TypeScript `strict` everywhere. Avoid `any`; prefer narrowing helpers in
  `@insiderflow/core`.
- **New markets**: normalization into the canonical schema belongs in `packages/core`;
  fetching belongs in a new `ingestion/*` worker. Check the legal notes in the README first —
  some exchanges (e.g. NSE/BSE) restrict redistribution.
- **Free tier only**: no dependency or service that requires payment to run the project.

## Data-source ground rules

- Respect the [SEC fair-access policy](https://www.sec.gov/os/accessing-edgar-data): declared
  `User-Agent`, max 10 requests/second, no scraping beyond published endpoints.
- Never commit API keys or `.env` files.

## License

InsiderFlow is licensed under AGPL-3.0. By contributing you agree that your contributions are
licensed under the same terms.

import { createDbHandle, eq, ingestionState } from "@insiderflow/db";

import { jsonLogger } from "./http";
import { ingestFromFeed } from "./pipeline";

export interface Env {
  /** Postgres URL — Supabase transaction-pooler in prod, local docker in dev. */
  DATABASE_URL: string;
  /** Required by the SEC fair-access policy, e.g. "InsiderFlow/0.1 (you@example.com)". */
  EDGAR_USER_AGENT: string;
  /** Optional override; keep the default well under the 50 subrequests/invocation free-tier cap. */
  MAX_FILINGS_PER_RUN?: string;
}

export default {
  // Runs every minute; a filing appearing in the EDGAR feed lands in the DB
  // within one cron tick plus a few seconds of processing (< 2 min end to end).
  async scheduled(event, env, _ctx): Promise<void> {
    const started = Date.now();
    const handle = createDbHandle(env.DATABASE_URL);
    try {
      const stats = await ingestFromFeed({
        db: handle.db,
        userAgent: env.EDGAR_USER_AGENT,
        maxFilings: env.MAX_FILINGS_PER_RUN ? Number(env.MAX_FILINGS_PER_RUN) : undefined,
      });
      jsonLogger("cron_complete", { cron: event.cron, durationMs: Date.now() - started, ...stats });
    } finally {
      await handle.end();
    }
  },

  // Health check: reports the last ingestion cursor.
  async fetch(_request, env): Promise<Response> {
    const handle = createDbHandle(env.DATABASE_URL);
    try {
      const [cursor] = await handle.db
        .select()
        .from(ingestionState)
        .where(eq(ingestionState.key, "edgar:cursor"));
      return Response.json({
        service: "insiderflow-edgar-worker",
        status: "ok",
        lastRun: cursor?.value ?? null,
      });
    } catch (error) {
      return Response.json(
        {
          service: "insiderflow-edgar-worker",
          status: "degraded",
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    } finally {
      await handle.end();
    }
  },
} satisfies ExportedHandler<Env>;

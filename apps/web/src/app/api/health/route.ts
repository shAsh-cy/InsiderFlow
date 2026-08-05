import { buildHealthReport } from "@/lib/api/health";
import { getDb } from "@/lib/db";

/**
 * Service health. Never cached — a cached health check is a lie with a TTL.
 *
 * STATUS CODE SEMANTICS, deliberately: 200 while the service is serving, even
 * when a background job is behind; 503 only when the database is unreachable,
 * because that is when the site itself is down. An uptime monitor pointed here
 * should page for "the site is down", not for "EDGAR was quiet overnight" —
 * that distinction is what stops a pager from being ignored. Ingestion
 * staleness is reported in the body and pushed to the ops chat by the
 * ops-alert workflow instead.
 */
export async function GET(): Promise<Response> {
  const noStore = {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const report = await buildHealthReport(getDb());
    return new Response(JSON.stringify(report), { status: 200, headers: noStore });
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: "down",
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "database unreachable",
      }),
      { status: 503, headers: noStore },
    );
  }
}

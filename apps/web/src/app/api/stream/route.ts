/**
 * Live trade feed over Server-Sent Events, designed for serverless:
 * the function never holds a connection longer than ~25s. Each window
 * catches up from the client's Last-Event-ID cursor, streams new rows as
 * `trade` events, then closes — EventSource reconnects automatically and
 * resumes losslessly from Last-Event-ID.
 *
 * `?mode=poll` returns one JSON batch + next cursor for SWR/polling
 * clients (the fallback when EventSource is unavailable).
 *
 * The push source is the transactions table itself (the ingestion worker
 * writes via short-lived connections, so no LISTEN/NOTIFY is held here);
 * on Supabase, Realtime database-changes can replace the in-window poll —
 * see the note at the bottom of this file.
 */
import {
  and,
  asc,
  companies,
  eq,
  filings,
  insiders,
  isNull,
  or,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { checkRateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { serializeTrade } from "@/lib/api/queries";
import type { TradeRow } from "@/lib/api/queries";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const WINDOW_MS = 25_000;
const POLL_INTERVAL_MS = 2_500;
const MAX_BATCH = 100;
const RETRY_MS = 3_000;

interface Cursor {
  epochMs: number;
  id: string;
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  const [ms, id] = raw.split(":");
  const epochMs = Number(ms);
  if (!Number.isFinite(epochMs) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { epochMs, id };
}

const eventId = (t: TradeRow): string => `${new Date(t.createdAt).getTime()}:${t.id}`;

async function fetchSince(db: Database, cursor: Cursor, limit = MAX_BATCH): Promise<TradeRow[]> {
  const rows = await db
    .select({
      id: transactions.id,
      source: transactions.source,
      country: transactions.country,
      txnDate: transactions.txnDate,
      code: transactions.code,
      rawCode: transactions.rawCode,
      relevance: transactions.relevance,
      shares: transactions.shares,
      price: transactions.price,
      value: transactions.value,
      currency: transactions.currency,
      priceUsd: transactions.priceUsd,
      valueUsd: transactions.valueUsd,
      acquiredDisposed: transactions.acquiredDisposed,
      sharesOwnedAfter: transactions.sharesOwnedAfter,
      is10b51: transactions.is10b51,
      isDerivative: transactions.isDerivative,
      footnote: transactions.footnote,
      createdAt: transactions.createdAt,
      companyId: companies.id,
      companyTicker: companies.ticker,
      companyName: companies.name,
      insiderId: insiders.id,
      insiderName: insiders.name,
      insiderTitle: insiders.officerTitle,
      insiderIsDirector: insiders.isDirector,
      insiderIsOfficer: insiders.isOfficer,
      insiderIsTenPct: insiders.isTenPctOwner,
      filingAccessionNo: filings.accessionNo,
      filingFormType: filings.formType,
      filingFiledAt: filings.filedAt,
      filingSourceUrl: filings.sourceUrl,
      filingSupersededBy: filings.supersededByFilingId,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .innerJoin(insiders, eq(transactions.insiderId, insiders.id))
    .leftJoin(filings, eq(transactions.filingId, filings.id))
    .where(
      and(
        // Explicit casts: inside a row constructor Postgres cannot infer
        // parameter types, and the failure would otherwise be silent here.
        sql`(${transactions.createdAt}, ${transactions.id}) > (${new Date(cursor.epochMs).toISOString()}::timestamptz, ${cursor.id}::uuid)`,
        or(isNull(transactions.filingId), isNull(filings.supersededByFilingId)),
      ),
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(limit);
  return rows.map((r) => serializeTrade(r));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request): Promise<Response> {
  const rate = await checkRateLimit(req);
  if (!rate.allowed) {
    return Response.json(
      { error: { code: "rate_limited", message: "Rate limit exceeded" } },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  const url = new URL(req.url);
  const db = getDb();
  const initialCursor = parseCursor(req.headers.get("last-event-id")) ??
    parseCursor(url.searchParams.get("last_event_id")) ??
      // No cursor → start from "now": stream only trades ingested from here on.
      { epochMs: Date.now(), id: ZERO_UUID };

  // ── JSON polling fallback (SWR-friendly) ─────────────────────────────────
  if (url.searchParams.get("mode") === "poll") {
    const events = await fetchSince(db, initialCursor);
    const last = events[events.length - 1];
    return Response.json(
      {
        events: events.map((t) => ({ id: eventId(t), event: "trade", data: t })),
        cursor: last ? eventId(last) : `${initialCursor.epochMs}:${initialCursor.id}`,
        retryMs: 5000,
      },
      { headers: { ...rateLimitHeaders(rate), "Cache-Control": "no-store" } },
    );
  }

  // ── SSE window ────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  let aborted = false;
  req.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const startedAt = Date.now();
      let cursor = initialCursor;

      send(`retry: ${RETRY_MS}\n\n`);
      send(`: insiderflow stream window=${WINDOW_MS}ms\n\n`);

      try {
        while (!aborted && Date.now() - startedAt < WINDOW_MS) {
          const events = await fetchSince(db, cursor);
          for (const trade of events) {
            send(`id: ${eventId(trade)}\nevent: trade\ndata: ${JSON.stringify(trade)}\n\n`);
          }
          const last = events[events.length - 1];
          if (last) {
            cursor = { epochMs: new Date(last.createdAt).getTime(), id: last.id };
          } else {
            send(`: ping ${new Date().toISOString()}\n\n`);
          }
          await sleep(POLL_INTERVAL_MS);
        }
        // Tell well-behaved clients this close is intentional; EventSource
        // reconnects with Last-Event-ID and no events are lost.
        if (!aborted) send(`event: window_end\ndata: {"reconnect":true}\n\n`);
      } catch (error) {
        // DB hiccup mid-window: log, close; the client reconnects and resumes.
        console.error("stream_window_error", error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...rateLimitHeaders(rate),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Supabase Realtime note: with realtime enabled on the transactions table
// (`alter publication supabase_realtime add table transactions;`), the
// in-window poll above can be replaced by a database-changes subscription
// scoped to the window. The cursor/reconnect contract stays identical, so
// clients never notice the transport difference.

/**
 * The `/api/stream` resume cursor — `<epoch-ms>:<uuid>`.
 *
 * Extracted from the route so it can be tested directly. A `route.ts` may
 * only export handlers and segment config, so a parser that lives inside
 * one is a parser nothing can call.
 *
 * ── WHY THE UPPER BOUND EXISTS ────────────────────────────────────────
 *
 * The check used to be `Number.isFinite(epochMs)`, which is true of
 * `1e30`. That value survived parsing and reached
 * `new Date(cursor.epochMs).toISOString()` in the route, where it throws
 * `RangeError: Invalid time value` — the Date range is +/-8.64e15 ms, and
 * finite is a much weaker claim than representable.
 *
 * On the SSE path the stream's own try/catch swallowed it, so it degraded
 * to a closed window. On `?mode=poll` the await is unguarded and this
 * handler is not wrapped in `handleApi`, so the throw escaped as a 500.
 * Measured on the running server before this change:
 *
 *   GET /api/stream?mode=poll&last_event_id=1e30:00000000-…-000000000000
 *     → 500       (and the same for -1e30)
 *   …&last_event_id=1e400:…  → 200, because 1e400 parses to Infinity and
 *                              the old finite check already caught it
 *
 * No session is required to reach it. That is a 500 an anonymous caller
 * can produce at will from a query string, which is a smaller thing than
 * a data leak and still not something to leave in place once seen.
 *
 * ── WHY null RATHER THAN A CLAMP OR A 400 ─────────────────────────────
 *
 * Returning null puts a hostile cursor on exactly the path a malformed
 * one already took: the caller is treated as having no cursor and the
 * stream starts from "now". A clamp would invent a resume point nobody
 * asked for, and a 400 would be a new failure mode for what has always
 * been a recoverable input — a client that has been offline long enough
 * for its cursor to rot should reconnect, not error.
 */
export interface Cursor {
  epochMs: number;
  id: string;
}

/**
 * How far into the future a cursor may sit before it is nonsense.
 *
 * A cursor comes from `Date.parse(row.createdAt)` on this server, so in
 * normal use it is always in the past. The allowance is for a client
 * whose clock ran ahead when it built one from its own `Date.now()`, and
 * for the seconds between a row being written and being read back.
 */
const MAX_CLOCK_SKEW_MS = 60_000;

export function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  const [ms, id] = raw.split(":");
  const epochMs = Number(ms);
  if (!Number.isFinite(epochMs) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  // Before the epoch is not a resume point this service can have issued,
  // and far ahead of it is either a broken clock or an attempt at the
  // RangeError above. Both mean "start from now".
  if (epochMs < 0 || epochMs > Date.now() + MAX_CLOCK_SKEW_MS) return null;
  return { epochMs, id };
}

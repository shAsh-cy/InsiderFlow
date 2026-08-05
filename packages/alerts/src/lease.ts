/**
 * Generic compare-and-set lease over `scanner_state`.
 *
 * Extracted from the alert scanner because the digest needs the same
 * protection: once a GitHub Actions backstop can flush digests alongside the
 * worker's hourly cron, two runners can load the same pending rows and send
 * them twice. `alerts_log` idempotency does NOT save us here — it prevents a
 * duplicate *row*, not a duplicate *send* of a row that is already logged.
 *
 * A lease (rather than a session advisory lock) because transaction-mode
 * connection pooling does not guarantee session state between statements.
 */
import { and, eq, isNull, lt, or, scannerState, sql } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

/** Ensure the lease row exists. Safe to call concurrently. */
async function ensureRow(db: Database, name: string): Promise<void> {
  await db.insert(scannerState).values({ name }).onConflictDoNothing();
}

export interface LeaseResult<T> {
  acquired: boolean;
  result: T | null;
}

/**
 * Run `fn` while holding the named lease; skip cleanly if another runner has
 * it. The lease is released in a `finally`, and it expires on its own if the
 * process dies mid-run.
 *
 * `lt()` (not a raw sql template) so Drizzle binds `now` via the column's
 * timestamptz type — a bare template sends the Date as its JS toString(),
 * which postgres.js rejects and PGlite silently tolerates.
 */
export async function withLease<T>(
  db: Database,
  name: string,
  options: { leaseSeconds?: number; owner?: string; now?: Date },
  fn: () => Promise<T>,
): Promise<LeaseResult<T>> {
  const now = options.now ?? new Date();
  const leaseSeconds = options.leaseSeconds ?? 600;
  const lockedUntil = new Date(now.getTime() + leaseSeconds * 1000);

  await ensureRow(db, name);

  const claimed = await db
    .update(scannerState)
    .set({ lockedUntil, lockOwner: options.owner ?? "unknown", updatedAt: now })
    .where(
      and(
        eq(scannerState.name, name),
        or(isNull(scannerState.lockedUntil), lt(scannerState.lockedUntil, now)),
      ),
    )
    .returning({ name: scannerState.name });

  if (claimed.length === 0) return { acquired: false, result: null };

  try {
    return { acquired: true, result: await fn() };
  } finally {
    // A separate statement from anything fn() wrote — data-modifying CTEs in
    // one statement share a snapshot and cannot see each other's rows.
    await db
      .update(scannerState)
      .set({ lockedUntil: null, lockOwner: null, lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(scannerState.name, name))
      .catch(() => {
        /* lease expires on its own; never mask the original error */
      });
  }
}

/** Age of a lease row's last successful run, in seconds. Null when it has never run. */
export async function lastRunAgeSeconds(db: Database, name: string): Promise<number | null> {
  const [row] = await db
    .select({ lastRunAt: scannerState.lastRunAt })
    .from(scannerState)
    .where(eq(scannerState.name, name));
  if (!row?.lastRunAt) return null;
  return Math.floor((Date.now() - row.lastRunAt.getTime()) / 1000);
}

export const DIGEST_LEASE = "alerts:digest";

/** Exposed for the health endpoint. */
export const leaseState = (db: Database) =>
  db
    .select({
      name: scannerState.name,
      lastRunAt: scannerState.lastRunAt,
      lockedUntil: scannerState.lockedUntil,
      lockOwner: scannerState.lockOwner,
      cursorCreatedAt: scannerState.cursorCreatedAt,
      updatedAt: scannerState.updatedAt,
    })
    .from(scannerState)
    .orderBy(sql`${scannerState.name}`);

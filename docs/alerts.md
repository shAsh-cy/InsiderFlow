# Alerting

Alerts turn the tape into something you do not have to watch. A rule is either
a **saved screen** (the same filters the screener uses) or a **tracked
ticker/insider**; matches go out over Telegram immediately or roll into a daily
email digest.

## Runtime choice: the existing Cloudflare worker

The scanner runs as a step inside the **EDGAR worker's existing 1-minute cron**,
with a **second hourly cron** for digests.

Why this over a GitHub Actions schedule:

- **Latency.** Actions' shortest schedule is 5 minutes and it queues under load;
  a 60-second alert SLA is not reachable. The worker already ticks every minute.
- **No extra moving parts.** The worker holds a database handle for that tick
  anyway — scanning costs one extra query when nothing matches.
- **Free tier.** Cloudflare allows 5 cron triggers per worker; we use 2.
- **It is not tied to ingestion.** The scanner is cursor-driven over the
  `transactions` table, so it picks up rows from _any_ writer — the worker, the
  GitHub Actions backfill, or the optional india-local runner.

Anything that can reach Postgres can run the scanner (`scanForMatches` +
`dispatchInstant` from `@insiderflow/alerts`), so moving it later is a
config change, not a rewrite.

## Robustness

The pipeline has several writers, so the scanner never assumes it caused a write.

| Property           | Mechanism                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**         | `(created_at, id)` tuple — ids break ties, so a batch can never split mid-tuple.                                                                                                                         |
| **Overlap safety** | A **lease** (`scanner_state.locked_until`), not a session advisory lock: transaction-mode poolers do not guarantee session state between statements. A second runner finding a live lease exits cleanly. |
| **Idempotency**    | `alerts_log` unique `(rule_id, dedup_key)`. Re-runs, crashed batches, and amendment re-homes cannot double-fire.                                                                                         |
| **At-least-once**  | The cursor advances only _after_ dispatch. A crash re-scans; the unique index absorbs the duplicate work.                                                                                                |
| **Amendments**     | Rows on superseded filings are excluded from candidacy. A re-homed row keeps its `dedup_key`, so the unique index blocks a second alert.                                                                 |
| **Freshness**      | An instant match whose event is older than `ALERT_INSTANT_MAX_AGE` (default 60 min) routes to the digest with `defer_reason = 'stale'`. See below.                                                       |
| **No dead rows**   | A pending alert whose subject no longer exists is retired to `status = 'orphaned'` with a structured log line, instead of being retried forever and counted nowhere. See below.                          |

⚠ **CTE warning.** Cursor claim/advance and `alerts_log` writes are deliberately
separate statements. Data-modifying CTEs in one statement share a snapshot and
cannot see each other's rows — the same trap that silently broke an amendment
fixture. Do not "optimize" them into one `WITH` chain.

### Freshness guard

The scan cursor makes the engine at-least-once, which means a reset, a backfill,
or a replay re-presents historical rows as new. Without a guard, every one of
them would fire a push as if it had just happened.

So an instant match is downgraded to the digest when its **event** is older than
`ALERT_INSTANT_MAX_AGE` minutes (default 60):

- **transactions** — filing acceptance time (`filings.filed_at`), falling back to
  when we first saw the row for sources that have no filing. Both are old on a
  replay and both are fresh on a live insert.
- **clusters** — the last trade date in the anchored window.
- **politician disclosures** — the _older_ of the disclosure date and our row's
  age, so neither a first import of two years of history nor a cursor reset can
  spam. The disclosure date is taken at end of day, since it is a date with no
  time; anchoring it to noon would make every same-day filing "stale" from 13:00
  UTC onward.

The downgrade is recorded in `alerts_log.defer_reason` (`'stale'`, or
`'quiet_hours'` when quiet hours caused it), so a quiet digest can be explained
rather than guessed at.

### Orphaned alerts

Dispatch renders a message by joining the alert's subject. When that subject is
deleted — a fixture purge, a hard delete — the old inner join dropped the row
entirely: invisible in every count, undeliverable forever, retried on every run.

The joins are now LEFT joins, and a pending row with a missing subject is marked
`status = 'orphaned'` with an `alert_orphaned` log line carrying the dedup keys.
That state is **terminal**: delivery failures stay `pending` (with `error` set)
so the next run retries, and only a missing subject is retired. Migration 0007
back-fills any rows already stuck in that state.

### Alert kinds

`alert_rules.kind` and `alerts_log.kind` select the feed a rule watches. All
three share this document's delivery contract — `(rule_id, dedup_key)`
idempotency, quiet hours, freshness, digest batching, the same dispatch path.

| Kind          | Scanner                | Dedup identity                                                 |
| ------------- | ---------------------- | -------------------------------------------------------------- |
| `transaction` | `scanForMatches`       | the transaction's cross-source `dedup_key`                     |
| `cluster`     | `scanClusterAlerts`    | `cluster:{company}:{direction}:{window_start}:{insider_count}` |
| `politician`  | `scanPoliticianAlerts` | `politician:{trade_id}`                                        |

The insider count is part of the cluster key **on purpose**: a cluster growing
from 2 insiders to 3 mints a new key and fires exactly once for that crossing,
while a scan that sees the same 3 insiders again reuses the key and is absorbed
by the unique index. `window_start` is the cluster's anchor (the earliest
qualifying trade), so it does not churn day to day.

Cluster and politician alerts have no transaction to join, so they persist a
rendered candidate in `alerts_log.payload` and dispatch reads it from there.

## Channels

**Telegram is primary** — free, unlimited, real-time. Link it in Settings: the
app issues a one-time token and opens `https://t.me/<bot>?start=<token>`; the
webhook at `/api/alerts/telegram` binds that chat to the account.

**Email is rationed.** Resend's free tier is 100 emails/day and 3,000/month —
the binding constraint on the whole system. So:

- Instant email only for rules that explicitly list `email` in their channels.
- Everything else batches into **one digest send per user per day**, no matter
  how many alerts it covers.
- A new rule's default mode follows from its channels, not from a constant:
  **digest only when `email` is one of them**, instant otherwise. The cap is on
  Resend, not on Telegram, so batching a Telegram-only rule would buy nothing
  and cost latency. (`defaultAlertMode` in `apps/web/src/lib/alerts/policy.ts`,
  applied by both the "Save as alert" button and `POST /api/me/alert-rules`.)
- Every email carries RFC 8058 one-click unsubscribe
  (`List-Unsubscribe` + `List-Unsubscribe-Post`), handled at
  `/api/alerts/unsubscribe`. Unsubscribing disables email and strips `email`
  from that user's rules; Telegram is unaffected.

Web Push (VAPID) is the stretch channel — the `webpush` enum value and channel
row exist, but no dispatcher ships yet.

## Quiet hours

Per-rule, in the user's timezone, and they may wrap midnight (22:00 → 07:00).
An instant alert inside the window is **downgraded to the digest, not dropped**
— it still arrives, just at a civilized hour.

## Environment

| Variable                  | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `SITE_URL`                | Public origin used in email links.                                 |
| `TELEGRAM_BOT_TOKEN`      | Bot token from @BotFather (worker + web).                          |
| `TELEGRAM_BOT_USERNAME`   | Username without `@`, for the `/start` deep link.                  |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret; the webhook rejects traffic without it.             |
| `RESEND_API_KEY`          | Digest + opted-in instant email.                                   |
| `RESEND_FROM`             | Verified sender address.                                           |
| `ALERT_INSTANT_MAX_AGE`   | Minutes an event may be old and still fire instantly (default 60). |

Register the webhook once:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<your-deployment>/api/alerts/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

## Testing

`packages/alerts/src/alerts.test.ts` runs the real engine on PGlite (never the
dev database) and covers: a matching insert firing once to Telegram + opted-in
email, replays not re-firing, amendment re-homes not re-firing, superseded rows
skipped, five events batching into exactly **one** digest send, per-user
isolation, lease-based overlap safety, cursor advancement, quiet-hours
downgrade, `min_value_usd` never treating a missing value as zero, a stale event
routing to the digest while a fresh filing still fires instantly, an alert whose
transaction was deleted being retired without blocking the rest of the digest,
cluster alerts firing once per threshold crossing, and politician alerts
matching on the disclosed upper bound and rendering the bracket rather than a
point value.

**Screener/alert parity.** Any SQL-only filter (`cluster`, `dip`, `near_low`,
`sector`, `role`, `exec_only`, `min_anomaly_z`) is evaluated by the scanner
through `buildTradeConditions` — the same builder the screener and `/api/trades`
use — because a saved screen that alerts differently from how it screens is
worse than no alert. Two tests assert the scanner and the screener agree on the
Phase 8 additions, and the web query layer now calls that builder directly
rather than keeping a parallel implementation.

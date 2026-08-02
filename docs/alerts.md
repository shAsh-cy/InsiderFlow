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

⚠ **CTE warning.** Cursor claim/advance and `alerts_log` writes are deliberately
separate statements. Data-modifying CTEs in one statement share a snapshot and
cannot see each other's rows — the same trap that silently broke an amendment
fixture. Do not "optimize" them into one `WITH` chain.

## Channels

**Telegram is primary** — free, unlimited, real-time. Link it in Settings: the
app issues a one-time token and opens `https://t.me/<bot>?start=<token>`; the
webhook at `/api/alerts/telegram` binds that chat to the account.

**Email is rationed.** Resend's free tier is 100 emails/day and 3,000/month —
the binding constraint on the whole system. So:

- Instant email only for rules that explicitly list `email` in their channels.
- Everything else batches into **one digest send per user per day**, no matter
  how many alerts it covers.
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

| Variable                  | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `SITE_URL`                | Public origin used in email links.                     |
| `TELEGRAM_BOT_TOKEN`      | Bot token from @BotFather (worker + web).              |
| `TELEGRAM_BOT_USERNAME`   | Username without `@`, for the `/start` deep link.      |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret; the webhook rejects traffic without it. |
| `RESEND_API_KEY`          | Digest + opted-in instant email.                       |
| `RESEND_FROM`             | Verified sender address.                               |

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
downgrade, and `min_value_usd` never treating a missing value as zero.

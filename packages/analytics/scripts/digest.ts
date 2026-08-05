/**
 * Digest backstop.
 *
 * The Cloudflare worker's hourly cron is the primary digest runner — it is
 * what makes per-user local digest hours work. This exists for when the worker
 * was down, over quota, or mid-deploy at someone's digest hour: pending rows
 * would otherwise sit until the next tick that happens to line up.
 *
 * Safe to run alongside the worker because it takes the same lease. Without
 * that, two runners would load the same pending rows and send them both —
 * alerts_log idempotency prevents a duplicate ROW, not a duplicate SEND.
 *
 *   DATABASE_URL=... TELEGRAM_BOT_TOKEN=... pnpm --filter @insiderflow/analytics digest
 */
import { dispatchDigestExclusive } from "@insiderflow/alerts";
import { createDbHandle } from "@insiderflow/db";

const log = (event: string, data?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const handle = createDbHandle(databaseUrl);

try {
  const stats = await dispatchDigestExclusive({
    db: handle.db,
    owner: "gh-actions-backstop",
    siteUrl: process.env.SITE_URL ?? "https://insiderflow.dev",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    resendApiKey: process.env.RESEND_API_KEY,
    resendFrom: process.env.RESEND_FROM,
    log,
  });

  if (!stats.acquired) {
    // The worker is mid-flush. Nothing to do, and not a failure.
    log("digest_backstop_skipped", { reason: "lease_held" });
  } else {
    log("digest_backstop_complete", { ...stats });
  }
} catch (error) {
  log("digest_backstop_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  await handle.end();
}

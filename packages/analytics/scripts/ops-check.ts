/**
 * Ops health check → Telegram.
 *
 * Runs on a schedule from GitHub Actions and pushes to an ops chat when the
 * pipeline is degraded. Separate from /api/health's status code on purpose:
 * an uptime monitor should page when the SITE is down, this should nudge when
 * a BACKGROUND JOB is behind. Conflating them is how pagers get muted.
 *
 * Quiet when healthy — a bot that messages on every run trains you to ignore
 * it. Pass --always to force a message (useful for verifying the wiring).
 *
 *   OPS_TELEGRAM_CHAT_ID=... TELEGRAM_BOT_TOKEN=... \
 *     pnpm --filter @insiderflow/analytics ops-check
 *
 * Exit code is 0 even when degraded: a red Actions run for "EDGAR was quiet"
 * is noise. Use --strict to exit non-zero instead.
 */
import { createDbHandle } from "@insiderflow/db";

import { collectOpsStatus, formatOpsMessage } from "../src/ops";

const log = (event: string, data?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.OPS_TELEGRAM_CHAT_ID;
const always = process.argv.includes("--always");
const strict = process.argv.includes("--strict");

const handle = createDbHandle(databaseUrl);

try {
  const status = await collectOpsStatus(handle.db);
  log("ops_check", {
    degraded: status.degraded,
    problems: status.problems.length,
    ...status.counts,
  });

  const shouldNotify = status.degraded || always;
  if (!shouldNotify) {
    log("ops_check_quiet", { reason: "healthy" });
  } else if (!botToken || !chatId) {
    // Not an error: plenty of self-hosters will not wire an ops chat.
    log("ops_check_no_channel", {
      reason: "TELEGRAM_BOT_TOKEN or OPS_TELEGRAM_CHAT_ID unset",
      message: formatOpsMessage(status),
    });
  } else {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatOpsMessage(status),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      log("ops_check_send_failed", { status: response.status, body: await response.text() });
      process.exitCode = 1;
    } else {
      log("ops_check_sent", { chatId: "(redacted)" });
    }
  }

  if (strict && status.degraded) process.exitCode = 1;
} catch (error) {
  log("ops_check_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  await handle.end();
}

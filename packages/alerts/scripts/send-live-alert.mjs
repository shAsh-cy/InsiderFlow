#!/usr/bin/env node
/**
 * Deliver one real alert through the real providers.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * The delivery suite is thorough and it is entirely hermetic: forty tests
 * drive scan → queue → lease → dispatch → retire against PGlite with a
 * stub `fetchFn`. That stub answers `{ok: true}` to any bytes at all, so
 * it can prove our state machine and it cannot prove that Telegram or
 * Resend will accept what we hand them.
 *
 * `src/telegram-html.test.ts` closes most of that gap offline by applying
 * Telegram's documented parser rules to what the templates emit. This
 * script closes the rest the only way it can be closed — by sending.
 *
 * ── WHAT IT SENDS ─────────────────────────────────────────────────────
 *
 * Not a "hello world". The message is rendered by the SAME
 * `telegramMessage` / `instantEmail` the dispatcher calls, from a
 * candidate built out of the values that actually break these APIs: an
 * issuer name containing `&` and angle brackets, a rule name with markup
 * in it, an undisclosed value. If escaping regressed, Telegram answers
 * `400 Bad Request: can't parse entities` and this script says so.
 *
 * ── EXIT CODES ────────────────────────────────────────────────────────
 *
 *   0  a channel accepted the message. Delivery is proven for that one.
 *   1  a channel REJECTED it. The provider's own words are printed.
 *   2  no credentials, so nothing was sent and nothing was measured.
 *      Deliberately not 0: "not run" must never read as "passed", which
 *      is the mistake this project has made often enough to gate against.
 *
 * ── CREDENTIALS ───────────────────────────────────────────────────────
 *
 * Telegram   TELEGRAM_BOT_TOKEN  TELEGRAM_TEST_CHAT_ID
 * Email      RESEND_API_KEY      ALERT_EMAIL_FROM  ALERT_TEST_TO
 *
 * Either pair may be supplied alone. No secret is printed, echoed, or
 * included in an error message: the failure paths print the provider's
 * response body, and the token appears only in a URL this file builds and
 * never logs.
 *
 * Usage:
 *   pnpm alerts:send-live
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const { telegramMessage, instantEmail } = await import(
  pathToFileURL(resolve(root, "packages/alerts/src/format.ts")).href
);
const { sendTelegram, sendEmail } = await import(
  pathToFileURL(resolve(root, "packages/alerts/src/channels.ts")).href
);

/**
 * The awkward candidate, not the tidy one.
 *
 * `ZZ` prefixes throughout: this row is synthetic and the honesty
 * invariants reserve that prefix for data that must never be mistaken for
 * a filing. Nothing here is written to a database — but the message a
 * human receives says so too, in its rule name.
 */
const candidate = {
  id: "11111111-1111-4111-8111-111111111111",
  dedupKey: "zz-live-delivery-probe",
  createdAt: new Date(),
  txnDate: new Date().toISOString().slice(0, 10),
  code: "P",
  shares: 12345,
  price: null,
  value: null,
  valueUsd: null,
  currency: "USD",
  acquiredDisposed: "A",
  relevance: "high",
  source: "sec_edgar",
  country: "US",
  is10b51: false,
  companyId: "22222222-2222-4222-8222-222222222222",
  ticker: null,
  companyName: "ZZ Procter & Gamble <Class B> Holdings",
  insiderId: "33333333-3333-4333-8333-333333333333",
  insiderName: 'ZZ "Quote" Insider & Co',
  insiderTitle: "EVP, Research & Development",
};

const RULE_NAME = 'ZZ delivery probe <img src=x> & "quotes"';

const results = [];
let attempted = 0;

// ── Telegram ────────────────────────────────────────────────────────────
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_TEST_CHAT_ID;

if (botToken && chatId) {
  attempted += 1;
  const html = telegramMessage(RULE_NAME, candidate);
  console.log("── Telegram ───────────────────────────────────────────────");
  console.log(html);
  console.log("");
  const result = await sendTelegram({ botToken }, chatId, html);
  results.push(result);
  console.log(
    result.ok
      ? "  ACCEPTED — Telegram parsed the HTML and delivered it."
      : `  REJECTED — ${result.error}`,
  );
} else {
  console.log("── Telegram ── skipped: TELEGRAM_BOT_TOKEN / TELEGRAM_TEST_CHAT_ID not set");
}

// ── Email ───────────────────────────────────────────────────────────────
const resendKey = process.env.RESEND_API_KEY;
const from = process.env.ALERT_EMAIL_FROM;
const to = process.env.ALERT_TEST_TO;

if (resendKey && from && to) {
  attempted += 1;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://insiderflow.dev";
  const unsubscribeUrl = `${siteUrl}/api/alerts/unsubscribe?token=zz-live-delivery-probe`;
  const message = instantEmail(RULE_NAME, candidate, { siteUrl, unsubscribeUrl });
  console.log("");
  console.log("── Email ──────────────────────────────────────────────────");
  console.log(`  subject: ${message.subject}`);
  console.log(`  html:    ${message.html.length} bytes`);
  const result = await sendEmail({ apiKey: resendKey, from }, to, message, unsubscribeUrl);
  results.push(result);
  console.log(
    result.ok ? "  ACCEPTED — Resend queued the message." : `  REJECTED — ${result.error}`,
  );
} else {
  console.log("");
  console.log("── Email ── skipped: RESEND_API_KEY / ALERT_EMAIL_FROM / ALERT_TEST_TO not set");
}

console.log("");

if (attempted === 0) {
  console.error(
    [
      "No credentials were supplied, so NOTHING WAS SENT and nothing was measured.",
      "",
      "This is not a pass. The hermetic suite already proves the state machine;",
      "what is unproven without a live send is that the providers accept our",
      "payload. Set TELEGRAM_BOT_TOKEN + TELEGRAM_TEST_CHAT_ID and/or",
      "RESEND_API_KEY + ALERT_EMAIL_FROM + ALERT_TEST_TO and run this again.",
    ].join("\n"),
  );
  process.exit(2);
}

const rejected = results.filter((r) => !r.ok);
if (rejected.length > 0) {
  console.error(`${rejected.length} of ${attempted} channel(s) rejected the message.`);
  process.exit(1);
}

console.log(`${attempted} channel(s) accepted a message rendered by the shipping templates.`);

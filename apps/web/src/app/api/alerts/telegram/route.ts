import { completeTelegramLink } from "@/lib/api/user-queries";
import { getDb } from "@/lib/db";
import { isAuthorizedTelegramUpdate } from "@/lib/security/telegram-webhook";

/**
 * Telegram webhook. The only message it acts on is `/start <token>`, which
 * links a chat to the account that generated the token.
 *
 * ── WHAT THIS ENDPOINT IS WORTH TO AN ATTACKER ────────────────────────
 *
 * `completeTelegramLink` binds a Telegram chat id to whichever account
 * generated the link token. An unauthenticated caller who can post updates
 * here and who guesses or races a token gets a stranger's alert stream
 * delivered to their own chat. That is the whole prize, and it is why the
 * header below is a hard requirement rather than a nicety.
 *
 * ── AUTHENTICATION ────────────────────────────────────────────────────
 *
 * Telegram signs nothing. What it offers is `secret_token`, registered
 * once with `setWebhook` and returned on every update as
 * `X-Telegram-Bot-Api-Secret-Token`. That header is the only thing
 * distinguishing a real update from a forged one, so:
 *
 *   - it is REQUIRED. It used to be `if (expectedSecret && …)`, which
 *     meant that a deployment with TELEGRAM_WEBHOOK_SECRET unset accepted
 *     unauthenticated updates from anyone who found the URL. A missing
 *     secret is now a closed endpoint, not an open one — the failure mode
 *     of a misconfiguration must be "nothing works", never "everything is
 *     permitted";
 *   - it is compared in constant time, because `!==` on a secret leaks its
 *     prefix (see lib/security/constant-time.ts);
 *   - a mismatch is 401, not 403. The caller is unauthenticated rather
 *     than forbidden, and Telegram retries on both.
 *
 * THE PATH IS NOT A SECOND SECRET. `/api/alerts/telegram` is fixed and
 * public, and it is deliberately not being turned into a secret path: a
 * secret in a URL lands in access logs, proxy telemetry and `Referer`
 * headers, which is strictly worse than the same secret in a header that
 * none of those record. The header is the whole authentication boundary
 * and is treated as such.
 *
 * DEV / OUTBOUND-ONLY MODE. The local stack sends alerts out and never
 * registers a webhook, so no legitimate inbound update exists there and
 * refusing every one of them is correct. Outbound sending does not pass
 * through this handler and is unaffected.
 *
 * ── NO ORIGIN/CSRF GATE HERE. THAT IS A DECISION ──────────────────────
 *
 * `/api/me/*` gained a same-origin allowlist (lib/security/csrf.ts).
 * This route is EXEMPT, deliberately, and the exemption is not an
 * oversight for someone to "fix" later.
 *
 * The reason is that CSRF is an attack on AMBIENT credentials — the
 * browser attaching a cookie the user's page did not ask it to attach.
 * There is no ambient credential here. This endpoint is machine-to-
 * machine: Telegram's servers POST to it with an explicit secret header
 * and no cookie, and a browser is never the caller. The header IS the
 * authentication, compared in constant time above, and an attacker who
 * does not hold it gets 401 whatever origin they claim.
 *
 * Applying the allowlist would therefore protect nothing and break the
 * feature outright: Telegram sends no `Origin` and no `Referer`, and the
 * allowlist refuses a request carrying neither. Every genuine update
 * would become a 403. `e2e/csrf.spec.ts` asserts exactly that this did
 * not happen — no Origin and no secret is still 401, not 403.
 */
interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
}

async function reply(chatId: string, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => undefined);
}

const unauthorized = () =>
  Response.json(
    { error: { code: "unauthorized", message: "Invalid or missing webhook secret." } },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(req: Request): Promise<Response> {
  const presented = req.headers.get("x-telegram-bot-api-secret-token");
  if (!isAuthorizedTelegramUpdate(presented, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return unauthorized();
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const text = update?.message?.text?.trim() ?? "";
  const chatId = update?.message?.chat?.id;
  if (!chatId) return Response.json({ ok: true });

  const match = text.match(/^\/start\s+(\S+)$/);
  if (!match) {
    if (text.startsWith("/start")) {
      await reply(
        String(chatId),
        "Open InsiderFlow → Settings → <b>Link Telegram</b> to connect this chat to your account.",
      );
    }
    return Response.json({ ok: true });
  }

  const linked = await completeTelegramLink(getDb(), match[1]!, String(chatId)).catch(() => false);
  await reply(
    String(chatId),
    linked
      ? "✅ Linked. Your InsiderFlow alerts will arrive here.\n\n<i>Not investment advice.</i>"
      : "That link has expired. Generate a new one in InsiderFlow → Settings.",
  );
  return Response.json({ ok: true });
}

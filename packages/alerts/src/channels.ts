/**
 * Delivery channels.
 *
 * Telegram is PRIMARY: free, unlimited, real-time. Resend's free tier is
 * 100 emails/day / 3,000 per month, so email is reserved for rules that
 * explicitly opt into instant delivery — everything else batches into one
 * digest send per user per day.
 */
import type { DispatchResult } from "./types";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TelegramConfig {
  botToken: string;
  fetchFn?: FetchLike;
}

/**
 * Is this status worth retrying?
 *
 * Retrying a permanent failure forever is not caution, it is a stuck queue: a
 * row that can never be delivered stays `pending`, is reloaded every run, and
 * fails again — burning quota and hiding the real backlog behind a number that
 * never goes down.
 *
 *   400 — Telegram could not parse the payload (bad HTML entities, message
 *         too long, unknown chat). The SAME bytes will fail on every retry.
 *   403 — the user blocked the bot, or it was removed from the chat. Nothing
 *         we send later changes that.
 *
 * Everything else — 429 rate limits, 5xx, network errors, and 404 (which
 * Telegram returns for an invalid bot token, i.e. an operator mistake worth
 * surviving) — is transient and retried, bounded by MAX_DELIVERY_ATTEMPTS so
 * even a misconfiguration terminates instead of looping.
 */
export function isPermanentTelegramStatus(status: number): boolean {
  return status === 400 || status === 403;
}

export async function sendTelegram(
  config: TelegramConfig,
  chatId: string,
  html: string,
): Promise<DispatchResult> {
  const fetchFn = config.fetchFn ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      // Telegram puts the actionable part in the body ("can't parse entities:
      // Unsupported start tag ..."). Without it the operator sees only "400".
      const detail = await response.text().catch(() => "");
      return {
        channel: "telegram",
        ok: false,
        error: `telegram ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        permanent: isPermanentTelegramStatus(response.status),
      };
    }
    return { channel: "telegram", ok: true };
  } catch (error) {
    // A thrown fetch is a network fault, never a rejected payload.
    return {
      channel: "telegram",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      permanent: false,
    };
  }
}

export interface ResendConfig {
  apiKey: string;
  from: string;
  fetchFn?: FetchLike;
}

export async function sendEmail(
  config: ResendConfig,
  to: string,
  message: { subject: string; html: string; text: string },
  unsubscribeUrl: string,
): Promise<DispatchResult> {
  const fetchFn = config.fetchFn ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        // RFC 8058 one-click unsubscribe — required by Gmail/Yahoo bulk rules.
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        channel: "email",
        ok: false,
        error: `resend ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        // 4xx from Resend is a rejected message (invalid recipient, unverified
        // domain, payload too large); 408/429 are back-pressure, 5xx is theirs.
        permanent:
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429,
      };
    }
    return { channel: "email", ok: true };
  } catch (error) {
    return {
      channel: "email",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      permanent: false,
    };
  }
}

/** Deep link that starts the Telegram bot and hands it the one-time link token. */
export function telegramLinkUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;
}

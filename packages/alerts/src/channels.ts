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
      return { channel: "telegram", ok: false, error: `telegram ${response.status}` };
    }
    return { channel: "telegram", ok: true };
  } catch (error) {
    return {
      channel: "telegram",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
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
      return { channel: "email", ok: false, error: `resend ${response.status}` };
    }
    return { channel: "email", ok: true };
  } catch (error) {
    return {
      channel: "email",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Deep link that starts the Telegram bot and hands it the one-time link token. */
export function telegramLinkUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;
}

import { completeTelegramLink } from "@/lib/api/user-queries";
import { getDb } from "@/lib/db";

/**
 * Telegram webhook. The only message it acts on is `/start <token>`, which
 * links a chat to the account that generated the token.
 *
 * Telegram authenticates the webhook with a secret header set at
 * registration (setWebhook?secret_token=…), so unlinked traffic is dropped.
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

export async function POST(req: Request): Promise<Response> {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && req.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return new Response("forbidden", { status: 403 });
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

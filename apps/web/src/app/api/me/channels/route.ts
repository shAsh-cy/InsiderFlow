import { telegramLinkUrl } from "@insiderflow/alerts";
import { z } from "zod";

import { listChannels, startTelegramLink, updateChannelPrefs } from "@/lib/api/user-queries";
import { getSessionUser } from "@/lib/auth/supabase-server";
import { getDb } from "@/lib/db";

const patchSchema = z.object({
  channel: z.enum(["telegram", "email", "webpush"]),
  digestHour: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
  verified: z.boolean().optional(),
});

const unauthorized = () =>
  Response.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });
const noStore = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const channels = await listChannels(getDb(), user.id);
  // Never leak link/unsubscribe tokens to the client.
  return Response.json(
    {
      data: channels.map((c) => ({
        channel: c.channel,
        destination: c.destination,
        verified: c.verified,
        digestHour: c.digestHour,
        timezone: c.timezone,
      })),
    },
    { headers: noStore },
  );
}

/** Issue a Telegram deep link (`/start <token>`) for this user. */
export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "link-telegram") {
    return Response.json(
      { error: { code: "bad_request", message: "Unknown action" } },
      { status: 400 },
    );
  }
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    return Response.json(
      { error: { code: "not_configured", message: "TELEGRAM_BOT_USERNAME is not set" } },
      { status: 503 },
    );
  }
  const token = await startTelegramLink(getDb(), user.id);
  return Response.json(
    { data: { url: telegramLinkUrl(botUsername, token) } },
    { headers: noStore },
  );
}

export async function PATCH(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid patch" } },
      { status: 400 },
    );
  }
  const { channel, ...patch } = parsed.data;
  await updateChannelPrefs(getDb(), user.id, channel, patch);
  return Response.json({ data: { ok: true } }, { headers: noStore });
}

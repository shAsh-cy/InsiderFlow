import { z } from "zod";

import { defaultAlertMode } from "@/lib/alerts/policy";
import {
  createAlertRule,
  deleteAlertRule,
  listAlertRules,
  updateAlertRule,
} from "@/lib/api/user-queries";
import { getSessionUser } from "@/lib/auth/supabase-server";
import { tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";
import { refuseIfCrossOrigin } from "@/lib/security/csrf";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

const createSchema = z.object({
  name: z.string().min(1).max(80),
  /** Saved screen filters — validated with the SAME schema the screener uses. */
  filters: z.record(z.unknown()).optional(),
  trackedTicker: z.string().min(1).max(12).optional(),
  trackedInsiderId: z.string().uuid().optional(),
  kind: z.enum(["transaction", "cluster", "politician"]).default("transaction"),
  /** Omitted → derived from the channels by defaultAlertMode. */
  mode: z.enum(["instant", "digest"]).optional(),
  channels: z
    .array(z.enum(["telegram", "email", "webpush"]))
    .min(1)
    .default(["telegram"]),
  quietHoursStart: hhmm.nullish(),
  quietHoursEnd: hhmm.nullish(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(["instant", "digest"]).optional(),
  channels: z
    .array(z.enum(["telegram", "email", "webpush"]))
    .min(1)
    .optional(),
  quietHoursStart: hhmm.nullish(),
  quietHoursEnd: hhmm.nullish(),
});

const unauthorized = () =>
  Response.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });
const noStore = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return Response.json({ data: await listAlertRules(getDb(), user.id) }, { headers: noStore });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // AFTER the 401, never before — see the note in lib/security/csrf.ts.
  // A 403 to an anonymous caller would leak whether they hold a session.
  const refusal = refuseIfCrossOrigin(req);
  if (refusal) return refusal;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid rule", issues: parsed.error.issues } },
      { status: 400 },
    );
  }

  // Normalize the saved screen through the trades schema so a rule can
  // never store filters the query layer would reject.
  let filters: Record<string, unknown> | null = null;
  if (parsed.data.filters) {
    const screen = tradesQuerySchema.safeParse(parsed.data.filters);
    if (!screen.success) {
      return Response.json(
        { error: { code: "bad_request", message: "Invalid screen filters" } },
        { status: 400 },
      );
    }
    const { limit: _l, offset: _o, sort: _s, order: _r, ...rest } = screen.data;
    filters = rest as Record<string, unknown>;
  }

  const rule = await createAlertRule(getDb(), user.id, {
    ...parsed.data,
    // Digest only protects the metered email channel; anything else fires now.
    mode: parsed.data.mode ?? defaultAlertMode(parsed.data.channels),
    filters,
  });
  return Response.json({ data: rule }, { status: 201, headers: noStore });
}

export async function PATCH(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const refusal = refuseIfCrossOrigin(req);
  if (refusal) return refusal;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid patch" } },
      { status: 400 },
    );
  }
  const { id, ...patch } = parsed.data;
  await updateAlertRule(getDb(), user.id, id, patch);
  return Response.json({ data: { ok: true } }, { headers: noStore });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const refusal = refuseIfCrossOrigin(req);
  if (refusal) return refusal;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return Response.json(
      { error: { code: "bad_request", message: "id required" } },
      { status: 400 },
    );
  }
  await deleteAlertRule(getDb(), user.id, id);
  return Response.json({ data: { ok: true } }, { headers: noStore });
}

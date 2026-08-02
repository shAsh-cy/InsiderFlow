import { z } from "zod";

import {
  addWatchlistItem,
  importWatchlistItems,
  listWatchlist,
  removeWatchlistItem,
} from "@/lib/api/user-queries";
import { getSessionUser } from "@/lib/auth/supabase-server";
import { getDb } from "@/lib/db";

const itemSchema = z.object({
  kind: z.enum(["company", "insider"]),
  refId: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  market: z.string().min(1).max(4).default("US"),
});

const unauthorized = () =>
  Response.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });

const noStore = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const items = await listWatchlist(getDb(), user.id);
  return Response.json({ data: items }, { headers: noStore });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);

  // Bulk shape = the one-click localStorage import on first login.
  const bulk = z.object({ items: z.array(itemSchema).max(500) }).safeParse(body);
  if (bulk.success) {
    const imported = await importWatchlistItems(getDb(), user.id, bulk.data.items);
    return Response.json({ data: { imported } }, { headers: noStore });
  }

  const single = itemSchema.safeParse(body);
  if (!single.success) {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid watchlist item" } },
      { status: 400 },
    );
  }
  await addWatchlistItem(getDb(), user.id, single.data);
  return Response.json({ data: { ok: true } }, { headers: noStore });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const refId = url.searchParams.get("refId");
  if (!kind || !refId) {
    return Response.json(
      { error: { code: "bad_request", message: "kind and refId are required" } },
      { status: 400 },
    );
  }
  await removeWatchlistItem(getDb(), user.id, kind, refId);
  return Response.json({ data: { ok: true } }, { headers: noStore });
}

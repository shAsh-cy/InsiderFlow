import { z } from "zod";

import {
  addWatchlistItem,
  importWatchlistItems,
  listWatchlist,
  removeWatchlistItem,
} from "@/lib/api/user-queries";
import { getSessionUser } from "@/lib/auth/supabase-server";
import { getDb } from "@/lib/db";
import { refuseIfCrossOrigin } from "@/lib/security/csrf";

const itemSchema = z.object({
  kind: z.enum(["company", "insider"]),
  refId: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  market: z.string().min(1).max(4).default("US"),
});

/**
 * DELETE's query string, sharing POST's field constraints on purpose.
 *
 * `kind` used to be checked for non-emptiness only and then cast
 * (`kind as "company"`) into a comparison against the `watchlist_kind`
 * Postgres enum. `?kind=bogus` raised 22P02, and because this handler has
 * no try/catch and is not wrapped in `handleApi`, a textbook 400 was
 * served as a 500 to any signed-in user who mistyped a query parameter.
 * POST validated the identical field with the identical enum twenty lines
 * above — one branch of one file used the value before narrowing it while
 * its sibling did it right, which is the shape scripts/lint-api-schemas.mjs
 * exists to catch.
 *
 * `.pick` rather than a second literal enum: a third watchlist kind must
 * be impossible to add to one verb and not the other.
 */
const deleteQuerySchema = itemSchema.pick({ kind: true, refId: true });

const unauthorized = () =>
  Response.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });

const noStore = { "Cache-Control": "no-store" };

/**
 * GET is deliberately NOT origin-gated, here or on the sibling /api/me
 * routes. It changes nothing, and browsers omit `Origin` on same-origin
 * GET — gating it would refuse the app's own reads while protecting
 * nothing. The mutations below are the CSRF surface, and every one of
 * them is gated.
 */
export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const items = await listWatchlist(getDb(), user.id);
  return Response.json({ data: items }, { headers: noStore });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  // AFTER the 401, never before. An anonymous cross-origin request must
  // read as "we do not know you", not "you are known and refused" — the
  // latter tells an attacker's page whether the victim is signed in here.
  const refusal = refuseIfCrossOrigin(req);
  if (refusal) return refusal;
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
  const refusal = refuseIfCrossOrigin(req);
  if (refusal) return refusal;
  const query = new URL(req.url).searchParams;
  const parsed = deleteQuerySchema.safeParse({
    kind: query.get("kind"),
    refId: query.get("refId"),
  });
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message: "kind must be 'company' or 'insider', and refId is required",
        },
      },
      { status: 400 },
    );
  }
  await removeWatchlistItem(getDb(), user.id, parsed.data.kind, parsed.data.refId);
  return Response.json({ data: { ok: true } }, { headers: noStore });
}

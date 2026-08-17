import { NextResponse } from "next/server";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { requestOrigin } from "@/lib/auth/redirect";
import { refuseIfCrossOrigin } from "@/lib/security/csrf";

/**
 * Sign out — a POST, and origin-gated like every other cookie-authenticated
 * mutation in the app.
 *
 * ── WHY THE GATE IS HERE AND NOT JUST ON /api/me/* ────────────────────
 *
 * This route was left ungated when `lib/security/csrf.ts` was written,
 * and the omission was reachable: `supabase.auth.signOut()` revokes the
 * refresh token SERVER-side, not merely clearing a cookie (verified — a
 * `/api/me/watchlist` read with the same cookie answers 401 afterwards),
 * and a cross-origin `<form method="post" action="…/auth/signout">` that
 * submits itself is a simple request. No preflight, no CORS, no script:
 * any page on the internet could sign any InsiderFlow visitor out. The
 * damage is denial of session rather than data loss, which is why it is
 * low severity and not why it is acceptable — it is exactly the class the
 * same-origin check exists to close, and a gate with a hole in it is
 * worse than a documented absence.
 *
 * ── WHY THE REFUSAL DOES NOT LOCK ANYONE OUT ──────────────────────────
 *
 * The two callers are same-origin `<form method="post">` submissions
 * (`app/(shell)/settings/page.tsx` and `components/shell/account-menu.tsx`).
 * Browsers send `Origin` on a POST form navigation, and the check falls
 * back to `Referer`, which a same-origin navigation carries under the
 * default `strict-origin-when-cross-origin` referrer policy this app does
 * not override. A client that suppressed BOTH would be refused, and the
 * remedy is the one that already exists for a session you cannot end from
 * the UI: clear the cookie, or wait for it to expire.
 *
 * The gate runs BEFORE the sign-out, obviously, and also before any read
 * of the session — unlike `/api/me/*`, where it must run after the 401 so
 * a 403 cannot tell an attacker's page that the visitor is signed in.
 * There is no such oracle here: this route answers 303 whether or not a
 * session existed, so the refusal is a function of `Origin` alone and
 * reveals nothing about the caller.
 */
export async function POST(request: Request): Promise<Response> {
  const refusal = refuseIfCrossOrigin(request);
  if (refusal) return refusal;

  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  // Not new URL(request.url).origin — that is the bound address (0.0.0.0
  // in the container), which no browser will follow. See requestOrigin.
  return NextResponse.redirect(new URL("/", requestOrigin(request)), { status: 303 });
}

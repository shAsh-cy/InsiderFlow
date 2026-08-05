import { NextResponse } from "next/server";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { requestOrigin, safeRedirectPath } from "@/lib/auth/redirect";
import { upsertEmailChannel } from "@/lib/api/user-queries";
import { getDb } from "@/lib/db";

/**
 * OAuth / magic-link landing. Exchanges the code for a session, then seeds
 * the user's email channel so digests can reach them without extra setup.
 *
 * Everything that can go wrong here goes wrong in front of a user who has
 * just clicked a link and expects to be signed in, so every failure path ends
 * on /login with a reason — never a 500, and never a bare redirect that leaves
 * them wondering whether it worked.
 */

/** Reasons /login knows how to explain. Kept short: they end up in a URL. */
type CallbackError =
  "unconfigured" | "denied" | "missing_code" | "expired" | "exchange_failed" | "unexpected";

const backToLogin = (origin: string, reason: CallbackError, next?: string): Response => {
  const url = new URL("/login", origin);
  url.searchParams.set("error", reason);
  if (next && next !== "/settings") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Not url.origin — see requestOrigin: Next derives that from the bound
  // address, which is 0.0.0.0 inside the container.
  const origin = requestOrigin(request);
  const code = url.searchParams.get("code");
  // Never trust `next`: `new URL(next, origin)` honours an absolute URL over
  // its base, which made this an open redirect at the moment of highest trust.
  const next = safeRedirectPath(url.searchParams.get("next"));

  if (!isAuthConfigured()) return backToLogin(origin, "unconfigured");

  // The provider says no: the user cancelled at the consent screen, or the
  // app is not authorised. OAuth returns this as query params, not an error
  // code we would otherwise see.
  const providerError = url.searchParams.get("error") ?? url.searchParams.get("error_code");
  if (providerError) {
    const denied = /denied|cancel/i.test(
      `${providerError} ${url.searchParams.get("error_description") ?? ""}`,
    );
    return backToLogin(origin, denied ? "denied" : "exchange_failed", next);
  }

  // A magic link opened twice, or a bookmarked callback URL.
  if (!code) return backToLogin(origin, "missing_code", next);

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Supabase reports an expired or already-consumed link as a 4xx here.
      // Distinguished because the remedy differs: request a new link, versus
      // "something is misconfigured".
      const expired = /expired|invalid|used/i.test(error.message);
      return backToLogin(origin, expired ? "expired" : "exchange_failed", next);
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) {
        await upsertEmailChannel(getDb(), user.id, user.email);
      }
    } catch {
      // Channel seeding is best-effort — never block a successful sign-in on it.
    }

    return NextResponse.redirect(new URL(next, origin));
  } catch {
    // An auth outage or a database that will not accept the channel upsert.
    // The user gets an explanation; they do not get a stack trace.
    return backToLogin(origin, "unexpected", next);
  }
}

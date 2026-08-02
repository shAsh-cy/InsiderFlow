import { NextResponse } from "next/server";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { upsertEmailChannel } from "@/lib/api/user-queries";
import { getDb } from "@/lib/db";

/**
 * OAuth / magic-link landing. Exchanges the code for a session, then seeds
 * the user's email channel so digests can reach them without extra setup.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/settings";

  if (!isAuthConfigured() || !code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", url.origin));
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) {
      await upsertEmailChannel(getDb(), user.id, user.email);
    }
  } catch {
    // Channel seeding is best-effort — never block sign-in on it.
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

import { NextResponse } from "next/server";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { requestOrigin } from "@/lib/auth/redirect";

export async function POST(request: Request): Promise<Response> {
  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  // Not new URL(request.url).origin — that is the bound address (0.0.0.0
  // in the container), which no browser will follow. See requestOrigin.
  return NextResponse.redirect(new URL("/", requestOrigin(request)), { status: 303 });
}

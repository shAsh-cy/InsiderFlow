import { NextResponse } from "next/server";

import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";

export async function POST(request: Request): Promise<Response> {
  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/", new URL(request.url).origin), { status: 303 });
}

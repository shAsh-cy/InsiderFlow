import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * LOCALE / SESSION CACHE SAFETY — how it is actually guaranteed.
 *
 * Both the locale and the session live in cookies, so a shared cache serving
 * one visitor's HTML to another would leak a Hindi page (or signed-in chrome)
 * to the wrong person.
 *
 * What protects us is NOT a `Vary` header set here. Setting one is futile:
 * Next.js rewrites `Vary` on its own responses to the RSC negotiation headers
 * and drops anything we add. Verified against a production build —
 * `Vary: rsc, next-router-state-tree, …`, no `Cookie`.
 *
 * The real guarantee is that HTML from this app is never shared-cacheable at
 * all. The root layout reads cookies (for the session and for `getLocale()`),
 * which makes every page dynamic, and Next marks those responses
 * `Cache-Control: private, no-cache, no-store, must-revalidate`. `private` +
 * `no-store` is strictly stronger than `Vary: Cookie` — a shared cache may not
 * store the response under any key.
 *
 * That invariant is asserted by an e2e test ("HTML is never shared-cacheable"),
 * so making a page cacheable — the change that would reintroduce the risk —
 * fails the suite and forces the author to handle the locale cookie.
 *
 * /api/* is excluded from this matcher and is unaffected: those responses are
 * locale-agnostic by design (also asserted by a test) and are meant to be
 * shared-cached.
 */

/**
 * Refreshes the Supabase session cookie on navigation. Without this a
 * Server Component can read an expired token and bounce a signed-in user.
 *
 * No-ops when auth is unconfigured, so the app runs fully as a read-only
 * public site with no Supabase project.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // Auth outage must not take the public site down.
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the public API, and the SSE stream.
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

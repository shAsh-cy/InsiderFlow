import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findForbiddenInternalHeader } from "@/lib/security/internal-headers";

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
  /**
   * ── CVE-2025-29927, and exactly what this line is worth ──────────────
   *
   * A request carrying `x-middleware-subrequest` is claiming to be one
   * Next.js made to itself. Nothing outside sends it. It is rejected
   * outright rather than stripped: stripping makes a forged request
   * indistinguishable from an honest one, and the useful property of a
   * 400 is that it is visible — in a log, in a test, to whoever is
   * probing. Stripping also cannot be asserted from outside, and an
   * assertion nobody can make is how a control quietly becomes a no-op.
   *
   * Be precise about what this does NOT do. The CVE's mechanism is that
   * Next skips middleware when it sees this header, so on a VULNERABLE
   * version this check never runs — the code below is exactly what the
   * exploit is designed to jump over. What actually defeats the bypass
   * here is architectural and predates this line: middleware performs no
   * authorization at all. It refreshes a session cookie. Every protected
   * surface calls `getSessionUser()` for itself — `/api/me/*` returns 401
   * from inside the handler, protected pages resolve the user in the
   * component — so an attacker who successfully skips middleware skips a
   * cookie refresh and arrives at the same closed door.
   *
   * So this is a signal, plus a self-hosting guard. Vercel strips the
   * header at the platform edge, which is why the advisory lists
   * Vercel-hosted apps as unaffected — but InsiderFlow is AGPL and meant
   * to be self-hosted, and a contributor running `docker compose` or a
   * VPS behind their own nginx gets no such help. Defence that only
   * exists in someone else's infrastructure is not defence this project
   * ships. It costs one header lookup per request.
   */
  const forbidden = findForbiddenInternalHeader(request.headers);
  if (forbidden) {
    return NextResponse.json(
      {
        error: {
          code: "forbidden_internal_header",
          message: `${forbidden} is set by Next.js internally and must not be sent by a client.`,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

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

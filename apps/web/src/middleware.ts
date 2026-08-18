import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findForbiddenInternalHeader } from "@/lib/security/internal-headers";
import {
  CSP_ENFORCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
  buildCsp,
  createNonce,
  isLoopbackHost,
  shouldSendCsp,
} from "@/lib/security/csp";

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

  /**
   * ── CSP, and why the nonce goes on the REQUEST as well ────────────────
   *
   * Next.js applies the nonce to its own script tags by reading the
   * `Content-Security-Policy` header off the INCOMING request — that is
   * the documented App Router pattern, and it is the reason the header is
   * set in two places rather than one. Setting it only on the response
   * produces a policy whose nonce matches nothing in the document, which
   * fails in the least helpful way available: the page renders, and every
   * script in it is refused.
   *
   * `x-nonce` is passed along too so a Server Component can nonce
   * something of its own. Nothing does today; it costs a header and means
   * the next person to add an inline script has the value to hand rather
   * than a reason to reach for 'unsafe-inline'.
   *
   * Report-only is a deployment switch, not a default. It exists because
   * the honest way to introduce a policy to a running site is to watch it
   * break somewhere harmless first — but a switch left in the report-only
   * position by default is a policy that never enforces anything, so the
   * default here is enforcement and `CSP_REPORT_ONLY=true` is the
   * deliberate act.
   */
  const requestHeaders = new Headers(request.headers);
  const sendCsp = shouldSendCsp(request.headers);
  let policy: string | null = null;
  if (sendCsp) {
    const nonce = createNonce();
    policy = buildCsp({
      nonce,
      supabaseOrigin: url ? safeOrigin(url) : null,
      upgradeInsecure: !isLoopbackHost(request.headers.get("host")),
    });
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set(CSP_ENFORCE_HEADER, policy);
  }
  const cspHeader =
    process.env.CSP_REPORT_ONLY === "true" ? CSP_REPORT_ONLY_HEADER : CSP_ENFORCE_HEADER;
  const withCsp = <T extends NextResponse>(response: T): T => {
    if (policy) response.headers.set(cspHeader, policy);
    return response;
  };

  if (!url || !anonKey) return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        // `requestHeaders`, NOT `request` — rebuilding from the original
        // request here would drop the nonce header Next reads to stamp
        // its script tags, and would do it only on the responses that
        // refresh a session. That is a bug that appears once a token
        // expires and never in a fresh browser.
        response = NextResponse.next({ request: { headers: requestHeaders } });
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
  return withCsp(response);
}

/** The origin of a configured URL, or null if it is not one. */
function safeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    // Everything except static assets, the public API, and the SSE stream.
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

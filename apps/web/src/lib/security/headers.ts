/**
 * The response headers that are the same on every request.
 *
 * ── WHY HERE AND NOT IN THE MIDDLEWARE ────────────────────────────────
 *
 * `middleware.ts` already sets Content-Security-Policy, because that one
 * carries a per-request nonce and cannot be static. Everything below is
 * constant, and constants belong in `next.config.ts`'s `headers()` for a
 * reason that matters: the middleware matcher deliberately excludes
 * `/api/*`, `_next/static` and image files, so headers set there reach
 * documents and nothing else. `nosniff` on a JSON response and HSTS on a
 * static chunk are exactly the cases you want covered.
 *
 * These were listed as already in place. They were not — a check of the
 * running production build found Content-Security-Policy and no others.
 * That is the reason this file exists rather than a test alone.
 */

export interface SecurityHeader {
  key: string;
  value: string;
  /** Why it is here, and what it is worth. Read by the test, not decoration. */
  reason: string;
}

/**
 * Two years, subdomains included. The long max-age is the point: HSTS only
 * protects a visitor who has been here before, so a short one leaves a
 * window open on every return visit.
 *
 * `preload` is NOT set, and that is a decision. Preloading submits the
 * domain to a list baked into browser binaries; removal takes months and
 * propagates on the browser's release cadence, not yours. It is the right
 * end state for a domain that is certain of its https posture forever, and
 * an expensive mistake on one that is not yet deployed. Revisit after the
 * deployment has been live and https-only for a while.
 *
 * Sent on http too, where browsers ignore it per RFC 6797 §8.1 — that is
 * simpler and safer than conditioning it on a forwarded protocol header
 * the origin cannot attribute to the client.
 */
const HSTS = "max-age=63072000; includeSubDomains";

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  {
    key: "Strict-Transport-Security",
    value: HSTS,
    reason:
      "Pins https for return visitors, so a downgrade attempt on a coffee-shop network never reaches a request.",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
    reason:
      "Stops a browser second-guessing Content-Type. An API response that says application/json must never be executed as script because its first bytes looked like one.",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
    reason:
      "Clickjacking, for browsers that predate frame-ancestors. The CSP directive is the real control and says the same thing; this is the fallback, and it is one header.",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
    reason:
      "A visitor reading /insider/<uuid> must not hand that path to a third-party host. Same-origin requests keep the full referrer, which the CSRF gate's Referer fallback relies on.",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    reason:
      "This product asks for no device permissions at all. Denying them outright means a future dependency cannot quietly start asking.",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
    reason:
      "Prefetching resolves hostnames found in the document before a user clicks. Cheap to disable on a site whose outbound links are third-party filings.",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
    reason:
      "Severs the window.opener relationship, which is what stops a popup navigating the page that opened it.",
  },
];

/** The shape `next.config.ts` wants. */
export const securityHeadersForNextConfig = (): Array<{ key: string; value: string }> =>
  SECURITY_HEADERS.map(({ key, value }) => ({ key, value }));

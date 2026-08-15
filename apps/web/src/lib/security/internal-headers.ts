/**
 * Next.js internal request headers that a CLIENT must never supply.
 *
 * `x-middleware-subrequest` is how Next marks a request that middleware has
 * already handled, so that a middleware-initiated subrequest does not run
 * middleware again and loop forever. CVE-2025-29927 was that an EXTERNAL
 * request could carry it: Next believed the lie and skipped middleware
 * entirely, which on any app that put authorization in middleware meant
 * walking straight past it.
 *
 * Nothing legitimate sends this from outside. A browser does not, an API
 * client does not, and a proxy that adds it is misconfigured.
 */
export const NEXT_INTERNAL_REQUEST_HEADERS = ["x-middleware-subrequest"] as const;

/**
 * Does this request carry a header only Next.js is allowed to set?
 *
 * Presence is the whole test — the VALUE does not matter. The published
 * exploit used the literal `middleware`, and later variants used
 * `src/middleware` and a colon-separated repetition tuned to the number of
 * path segments; matching on any particular spelling would have been a
 * guard against one proof-of-concept rather than against the class.
 *
 * Case is handled by `Headers.get`, which lowercases names per the Fetch
 * spec, and repeated headers are handled by the same call: repeats arrive
 * already joined into one comma-separated value, so a request sending the
 * header five times is one non-null `get`. The `entries()` sweep underneath
 * is belt and braces for a runtime that does not normalise — it costs one
 * pass over a handful of headers on requests that are, in the normal case,
 * not carrying any of these at all.
 */
export function findForbiddenInternalHeader(headers: Headers): string | null {
  for (const name of NEXT_INTERNAL_REQUEST_HEADERS) {
    if (headers.get(name) !== null) return name;
  }
  const forbidden = new Set<string>(NEXT_INTERNAL_REQUEST_HEADERS);
  for (const [name] of headers.entries()) {
    if (forbidden.has(name.toLowerCase())) return name.toLowerCase();
  }
  return null;
}

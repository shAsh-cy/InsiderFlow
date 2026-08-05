/**
 * Post-login redirect safety.
 *
 * `/auth/callback?next=...` used to do `new URL(next, url.origin)`, which
 * looks bounded and is not: `new URL("https://evil.com", origin)` returns
 * `https://evil.com`, base ignored. That is an open redirect on the one route
 * a user reaches immediately after authenticating — the highest-trust moment
 * in a session, and so the most convincing place to land a phishing page.
 *
 * The rule is therefore a whitelist of shape, not a blacklist of hosts:
 * accept a same-origin PATH, reject everything else and fall back.
 */

export const DEFAULT_POST_LOGIN_PATH = "/settings";

/**
 * Whitespace and C0/C1 control characters, which have no business in a path
 * this app generated. Written as a code-point scan rather than a regex so the
 * source file contains no literal control characters of its own.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * A same-origin relative path, or the fallback.
 *
 * Accepted: `/settings`, `/stock/AAPL?tab=insiders`, `/x#frag`.
 * Rejected, each for a reason worth stating:
 *
 *   https://evil.com   absolute URL — `new URL` honours it over the base
 *   //evil.com         protocol-relative; a browser reads it as a host
 *   /\evil.com         browsers normalise `\` to `/`, so this IS `//evil.com`
 *   \\evil.com         the same trick without the leading slash
 *   settings           no leading slash: resolves against the CURRENT path,
 *                      which the caller cannot reason about
 *   a newline          control characters, per hasUnsafeCharacter above
 */
export function safeRedirectPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_PATH,
): string {
  if (!next) return fallback;
  if (hasUnsafeCharacter(next)) return fallback;

  // Must be rooted, and must not be the protocol-relative form in any spelling.
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;

  // Belt and braces: resolve against a throwaway origin and require that the
  // result did not escape it. Catches anything the string checks missed, and
  // returns the PARSER's output, so a later parse cannot disagree with this one.
  try {
    const probe = new URL(next, "https://redirect-probe.invalid");
    if (probe.origin !== "https://redirect-probe.invalid") return fallback;
    return `${probe.pathname}${probe.search}${probe.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Content-Security-Policy — a nonce policy, built per request.
 *
 * ── WHAT A CSP IS WORTH HERE, HONESTLY ────────────────────────────────
 *
 * This app renders no user-authored HTML: there is no comment field, no
 * rich-text note, no profile bio. React escapes everything it
 * interpolates, and `dangerouslySetInnerHTML` appears nowhere in the
 * tree. So CSP is not patching a known injection — it is the layer that
 * decides what happens the day one is introduced, by a dependency or by
 * a future feature that renders something an insider filing contained.
 *
 * That framing is what makes `script-src` the directive worth getting
 * right and the rest mostly hygiene.
 *
 * ── WHY A NONCE, AND WHY IT COSTS NOTHING HERE ────────────────────────
 *
 * The usual argument against a nonce is caching: a nonce must be unique
 * per response, so a nonce'd document cannot be cached and shared. That
 * argument does not apply to this app, and it was measured rather than
 * assumed — every document route already answers
 *
 *   Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
 *
 * because the root layout reads cookies for the session and the locale.
 * Nothing was shared-cacheable to begin with (see the note in
 * `middleware.ts` explaining why that is load-bearing for locale safety),
 * so per-response uniqueness costs exactly nothing.
 *
 * The alternative — a hash policy — is not available. Next.js emits the
 * RSC flight payload as a series of inline `self.__next_f.push([1,"…"])`
 * scripts whose contents are the page's data, so they differ per
 * response. There is no fixed set of hashes to enumerate. Measured on
 * this build: 21 inline scripts on `/`, 13 on `/design`, 16 on `/trades`.
 *
 * ── 'strict-dynamic' ──────────────────────────────────────────────────
 *
 * Next's inline bootstrap loads the rest of the app by injecting script
 * elements. Those injected scripts do not carry the nonce, so a policy of
 * `'self' 'nonce-…'` alone would nonce the bootstrap and then block
 * everything it loads. `'strict-dynamic'` propagates trust from a nonce'd
 * script to what it loads, which is precisely the shape of a framework
 * bootstrap.
 *
 * `'self'` is kept alongside it deliberately. A CSP3 browser ignores
 * host-source expressions once `'strict-dynamic'` is present; a CSP2 one
 * ignores `'strict-dynamic'` and honours `'self'`. Keeping both means the
 * older browser gets a real policy rather than none.
 */

/** Header names, so a typo cannot silently disable the policy. */
export const CSP_ENFORCE_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/**
 * 128 bits of randomness, base64.
 *
 * Web Crypto rather than `node:crypto`, because this runs in the Edge
 * runtime where the Node module does not exist. `randomUUID` would also
 * work and is what most examples use, but a UUID is 122 bits with six of
 * them fixed by the version and variant fields, and there is no reason to
 * hand those away when the alternative is the same one-liner.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface CspOptions {
  nonce: string;
  /**
   * The Supabase project origin, when auth is configured. The browser
   * talks to it directly for sign-in, so omitting it does not tighten
   * anything — it breaks logging in.
   */
  supabaseOrigin?: string | null;
  /**
   * Off on loopback. `upgrade-insecure-requests` would rewrite the dev
   * and e2e servers' own http requests to https, which nothing is
   * listening for.
   */
  upgradeInsecure: boolean;
  /**
   * Widen the policy for Cloudflare Turnstile — and ONLY when it is
   * actually configured.
   *
   * Turnstile renders a challenge in an iframe from
   * challenges.cloudflare.com and talks back to it. `frame-src` is the
   * directive that decides whether that iframe may exist at all, and
   * `frame-src` has no fallback to `default-src 'self'` that would let it
   * through by accident — an unconfigured deployment keeps the tighter
   * policy, and enabling the captcha is what opens exactly these two
   * origins and nothing else.
   */
  turnstile?: boolean;
}

/**
 * The policy, as one string.
 *
 * Every directive below is the tightest value the app was MEASURED to
 * work under, not the tightest value that exists. The inventory came from
 * loading all fifteen document routes plus the command palette and the
 * save-alert dialog with a request recorder attached: every request the
 * app makes is same-origin, and there are no external fonts, images,
 * analytics or CDNs to allow for.
 */
export function buildCsp({
  nonce,
  supabaseOrigin,
  upgradeInsecure,
  turnstile = false,
}: CspOptions): string {
  const connect = ["'self'"];
  if (supabaseOrigin) {
    // wss: too — Supabase Realtime upgrades, and a connect-src that
    // covers only https turns that into a silent reconnect loop.
    connect.push(supabaseOrigin, supabaseOrigin.replace(/^https:/, "wss:"));
  }

  // Cloudflare serves the widget script and the challenge iframe. Both are
  // added only when a site key exists — see `turnstile` in CspOptions.
  const TURNSTILE = "https://challenges.cloudflare.com";
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const directives: Array<[string, string]> = [
    // Everything not named below falls back to same-origin.
    ["default-src", "'self'"],
    ["script-src", scriptSrc],
    /*
     * `'unsafe-inline'` for styles, and it is a concession rather than an
     * oversight — so here is exactly what forced it and what it costs.
     *
     * The policy started as `style-src 'self'` with a separate
     * `style-src-attr 'unsafe-inline'` for React's `style={{…}}` output.
     * Report-only found 48 violations across the routes, and the
     * remaining one after the theme script was nonced is sonner: the
     * toast library injects a 14.8 KB stylesheet as a <style> element at
     * runtime and exposes no nonce hook to stamp it with. next-themes
     * DOES take a nonce (its transition-suppression style now carries
     * one, verified in the DOM), so this is one library, not a category.
     *
     * The alternative was pinning hashes. Three distinct ones were
     * measured, two of them transient, and every sonner release would
     * change them — with a failure mode of unstyled toasts that no test
     * would catch. A brittle control that breaks quietly is worse than a
     * loose one that is written down.
     *
     * What it costs is bounded, and the bound is the rest of this policy.
     * The classic CSS-injection attack exfiltrates data with attribute
     * selectors and a `background-image: url(https://attacker/…)`. That
     * requires an outbound request, and `img-src`, `font-src` and
     * `connect-src` here are same-origin only, so the CSS can be written
     * but it has nowhere to send anything. `script-src` — the directive
     * that matters — keeps its nonce and takes no `'unsafe-inline'`.
     */
    ["style-src", "'self' 'unsafe-inline'"],
    // `data:` for the inline SVG icons; `blob:` for the XLSX export,
    // which builds its file client-side and hands it to a blob URL.
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
    ["connect-src", connect.join(" ")],
    ["manifest-src", "'self'"],
    ["worker-src", "'self' blob:"],
    // No plugins, ever. `object-src 'none'` is the one directive every
    // CSP guide agrees is free.
    ["object-src", "'none'"],
    // A <base> tag rewrites where every relative URL on the page points,
    // which turns one injected element into control of all of them.
    ["base-uri", "'self'"],
    // Clickjacking. `frame-ancestors` is the header-level control that
    // X-Frame-Options approximates, and unlike it, it is not overridable
    // by a <meta> tag.
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    // `frame-src 'none'` unless the captcha is on. This directive does NOT
    // fall back to default-src, so naming it explicitly is what makes the
    // absence of an iframe surface a stated decision rather than a default.
    ["frame-src", turnstile ? TURNSTILE : "'none'"],
  ];

  const policy = directives.map(([name, value]) => `${name} ${value}`).join("; ");
  return upgradeInsecure ? `${policy}; upgrade-insecure-requests` : policy;
}

/**
 * Should this request get a nonce at all?
 *
 * Next's router prefetches the pages a visitor might click, and caches
 * the result in the client router. A prefetched document that carried a
 * nonce would be replayed later against a DIFFERENT response's policy,
 * and the scripts in it would be refused — the failure looks like a
 * navigation that renders nothing, and only on links the router happened
 * to prefetch.
 *
 * RSC payload requests are the same story from the other direction: they
 * are not documents, nothing in them is governed by a document policy,
 * and generating a nonce for them only creates one that must not be
 * reused.
 */
export function shouldSendCsp(headers: Headers): boolean {
  if (headers.get("next-router-prefetch") !== null) return false;
  if (headers.get("next-router-segment-prefetch") !== null) return false;
  if (headers.get("rsc") !== null) return false;
  return true;
}

/** Loopback hosts, where `upgrade-insecure-requests` is wrong. */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

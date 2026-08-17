/**
 * Same-origin enforcement for the cookie-authenticated write surface.
 *
 * ── WHAT IS ACTUALLY BROKEN WITHOUT THIS ──────────────────────────────
 *
 * `/api/me/watchlist`, `/api/me/alert-rules`, `/api/me/channels` and
 * `POST /auth/signout` are authenticated by the Supabase session cookie
 * and nothing else. The `/api/me/*` three hand-roll their responses
 * rather than going through `handleApi`, they read `req.json()` without
 * inspecting `Content-Type`, and until this module existed no handler in
 * the app read `Origin` or `Referer` at all.
 *
 * That list is the WHOLE cookie-authenticated mutating surface, and it is
 * meant to stay checkable: `grep -rE "export async function (POST|PATCH|
 * PUT|DELETE)" apps/web/src/app` returns these eight handlers plus the
 * two `/api/alerts/*` routes that are exempt on purpose (each carries its
 * own credential and its own note). `/auth/signout` was missing from an
 * earlier version of this list and from the gate — a plain cross-origin
 * `<form method=post>` is a simple request, sends no preflight, and could
 * therefore sign any visitor out from any page on the internet.
 *
 * That is a textbook CSRF target. `evil.example` serves a page that does
 *
 *   fetch("https://insiderflow.dev/api/me/alert-rules?id=<uuid>",
 *         { method: "DELETE", credentials: "include" })
 *
 * and the browser attaches the victim's session cookie because the cookie
 * is the whole credential. The response is unreadable cross-origin, but
 * the DELETE already happened — reading it was never the point. Deleting
 * somebody's alert rules, or repointing their Telegram digest, does not
 * need a readable response to be damage.
 *
 * SameSite is NOT the control here. The session cookie is written by
 * `@supabase/ssr`, which passes its own options straight through this
 * codebase's cookie adapters (`src/middleware.ts`,
 * `src/lib/auth/supabase-server.ts`) — so the attribute is the library's
 * default, not a decision this repo makes or can be sure of after an
 * upgrade. A defence you cannot point at in your own source is a defence
 * you are assuming.
 *
 * ── WHY A PURE FUNCTION ───────────────────────────────────────────────
 *
 * Same shape as `telegram-webhook.ts`: the decision is a function of its
 * inputs and is tested as one, and the route is only wiring. The
 * interesting cases here — an absent header, a lookalike domain, an
 * opaque origin — are all header values, and constructing them as strings
 * is honest, whereas persuading a real browser to emit each one is not
 * something a test suite can reliably do.
 */

/**
 * A header value reduced to a comparable origin, or null if it is not one.
 *
 * `new URL(...).origin` is doing the load-bearing work, and it is used
 * rather than any string handling on purpose:
 *
 *   - it parses scheme, host and port TOGETHER, so a comparison cannot be
 *     satisfied by a prefix. `https://evil-insiderflow.dev` and
 *     `https://insiderflow.dev.evil.example` both parse to themselves and
 *     neither is string-equal to `https://insiderflow.dev`. A
 *     `startsWith`/`endsWith`/`includes` check — the reflex here — passes
 *     one or both of those, which is the entire bug class;
 *   - it normalises the default port away, so `https://x:443` and
 *     `https://x` agree, while `http://x:3000` and `http://x:3100` do not;
 *   - a Referer carries a full URL with a path, and `.origin` discards the
 *     path for us rather than us writing a second parser to do it.
 *
 * The `"null"` guard is not paranoia. `URL.origin` returns the literal
 * STRING "null" for an opaque origin — a `data:` URL, a sandboxed iframe,
 * and any scheme the URL spec does not call special. Browsers really do
 * send `Origin: null` in those cases. Without this guard two unrelated
 * opaque origins would compare equal to each other, and worse, an
 * allowlist entry that failed to parse could land in the set as "null"
 * and start matching them.
 */
function toOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    // `Origin: null` (the literal header a browser sends for an opaque
    // origin) lands here too — it is not an absolute URL — which is the
    // answer we want either way.
    return null;
  }
}

/**
 * May a request carrying these headers mutate state?
 *
 * @param origin   the `Origin` header, or null when it was not sent
 * @param referer  the `Referer` header, or null when it was not sent
 * @param allowed  origins this deployment answers on; see
 *                 `allowedOriginsForRequest`
 *
 * ── THE RULES, AND WHY EACH ONE IS THE STRICT VERSION ─────────────────
 *
 * ORIGIN WINS. When `Origin` is present it is the only thing consulted
 * and `Referer` is not looked at. Origin is the header browsers are
 * required to send on every non-GET/HEAD request and the one they will
 * not let script forge; Referer is suppressed by privacy settings,
 * `Referrer-Policy`, and extensions. Consulting Referer as a SECOND
 * chance after Origin already said no would mean an attacker only has to
 * defeat the weaker of the two.
 *
 * BOTH ABSENT IS A REFUSAL. This is the rule that makes the check worth
 * having, and it is also the one that costs something, so it is worth
 * being exact about. A browser sends `Origin` on every POST, PATCH and
 * DELETE — same-origin ones included; verified against Chromium, which
 * sends `origin: <site>` and `referer:` on a same-origin `fetch` POST.
 * So for the browser traffic these routes exist to serve, "neither
 * header" never happens. It happens for a non-browser client: curl, a
 * script, Playwright's `APIRequestContext`. Accepting that case would
 * mean accepting the one shape an attacker's page cannot produce but
 * every CSRF proof-of-concept trivially avoids producing — i.e. it would
 * make the check optional, since a `<form>` post is the only classic
 * vector that even needs Origin, and it sends one. The cost is real and
 * deliberate: a script driving `/api/me/*` with a session cookie must now
 * send an `Origin` header.
 *
 * PRESENT-BUT-UNPARSEABLE IS A REFUSAL, WITH NO FALLBACK. An empty or
 * malformed `Origin` is not the same thing as an absent one. Falling
 * through to Referer when Origin is present and bad would hand an
 * attacker a downgrade: send a junk Origin, and be judged on the header
 * they have more influence over.
 *
 * AN EMPTY ALLOWLIST REFUSES EVERYTHING. Misconfiguration must fail
 * closed — the same rule `telegram-webhook.ts` was rewritten to obey
 * after `if (configured && …)` turned an unset variable into an open
 * endpoint.
 */
export function isSameOriginRequest(
  origin: string | null,
  referer: string | null,
  allowed: string[],
): boolean {
  const permitted = new Set<string>();
  for (const candidate of allowed) {
    const parsed = toOrigin(candidate);
    if (parsed) permitted.add(parsed);
  }
  if (permitted.size === 0) return false;

  // `!== null` and not truthiness: `""` is a header that was SENT empty,
  // which is malformed, not missing. See the rule above.
  if (origin !== null) {
    const presented = toOrigin(origin);
    return presented !== null && permitted.has(presented);
  }

  const fallback = toOrigin(referer);
  return fallback !== null && permitted.has(fallback);
}

/** Hosts whose scheme is http because nothing else can be reached there. */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * The origins this deployment considers its own.
 *
 * ── `Host` ONLY. NOT `X-Forwarded-Host`, NOT `X-Forwarded-Proto` ──────
 *
 * This used to call `requestOrigin()` — the derivation `/auth/callback`
 * and `/auth/signout` use to decide where to send a browser — on the
 * argument that one idea of "our origin" is better than two. The argument
 * was right about redirects and wrong about this, because the two answers
 * are used for different things:
 *
 *   a redirect must ECHO whatever the user asked for, or it points at an
 *   address their browser cannot reach — `requestOrigin` exists because
 *   `http://0.0.0.0:3000/...` was being emitted inside the container;
 *
 *   an allowlist DECIDES, and what goes into it is an authorization
 *   input. Taking one from a header the origin server cannot attribute to
 *   the browser means the caller names the origin it will be judged
 *   against.
 *
 * `requestOrigin` prefers `x-forwarded-host` over `host` and takes
 * `x-forwarded-proto` verbatim. Both are ordinary request headers that
 * any client can set. Measured against this app before the change: a POST
 * to `/api/me/watchlist` carrying a valid session cookie,
 * `Origin: https://evil.example`, `X-Forwarded-Host: evil.example` and
 * `X-Forwarded-Proto: https` was answered 200 and the row was written.
 *
 * `Host` is different in the way that matters here, and the distinction
 * is the whole justification for this function:
 *
 *   `Host` is a FORBIDDEN header name. Script cannot set it — `fetch` and
 *   `XMLHttpRequest` drop it — so on any request a browser makes, `Host`
 *   is the host the browser itself resolved: the site under attack, never
 *   the attacker's. `Origin` carries the attacker's. The two differ, and
 *   comparing them is the check.
 *
 *   `X-Forwarded-Host` is merely non-safelisted. A cross-origin page
 *   CANNOT smuggle it either, but only because it forces a CORS preflight
 *   and this app answers `OPTIONS` with no `Access-Control-Allow-Origin`
 *   — i.e. it is refused by a mechanism living somewhere else, that a
 *   later `OPTIONS` handler or a permissive CORS middleware could switch
 *   off without anyone connecting the change to this file.
 *
 * The residual, stated rather than left to be discovered: a NON-browser
 * client (curl, a script) can send any `Host` it likes and name its own
 * origin. That costs nothing. To attack anything it would first need the
 * victim's session cookie, and a caller holding that does not need CSRF —
 * it can simply make the request. The header check exists for the one
 * attacker who has a browser but not the cookie.
 *
 * ── THE COST, AND THE LEVER FOR IT ────────────────────────────────────
 *
 * A deployment whose proxy REWRITES `Host` to an internal name (and puts
 * the public one in `x-forwarded-host`) now derives the wrong origin and
 * refuses every write. That is fail-closed and it has a documented lever:
 * set `SITE_URL`, which is added on top rather than as a fallback, so
 * pinning the canonical origin keeps working whatever arrives in `Host`.
 * A proxy that PRESERVES `Host` — nginx `proxy_set_header Host $host`,
 * Vercel, Cloudflare — is unaffected.
 *
 * The scheme is derived rather than read for the same reason. Loopback is
 * http (the dev server on :3000 and the e2e production server on :3100),
 * everything else is https. A plaintext deployment on a public hostname
 * would be refused; that is the same fail-closed direction, with the same
 * lever, and it is not a shape this project ships.
 *
 * `SITE_URL` is the only such variable this repo defines —
 * `NEXT_PUBLIC_SITE_URL` and `VERCEL_URL` appear nowhere in it, and
 * inventing them here would create a configuration surface that no
 * deployment sets and nobody would notice was broken.
 */
export function allowedOriginsForRequest(req: Request): string[] {
  const allowed: string[] = [];
  const host = req.headers.get("host");
  // `0.0.0.0` is the bound address inside the container, never a host any
  // browser typed; admitting it would put a non-origin in the set.
  if (host && !host.startsWith("0.0.0.0")) {
    allowed.push(`${LOOPBACK_HOST.test(host) ? "http" : "https"}://${host}`);
  }
  const configured = process.env.SITE_URL;
  if (configured) allowed.push(configured);
  return allowed;
}

/**
 * Route wiring: the refusal to return, or null to carry on.
 *
 * 403 and not 401, and the distinction is the reason this is called AFTER
 * `getSessionUser()` in every handler: 401 means "we do not know who you
 * are", 403 means "we know, and this request still may not proceed". An
 * anonymous cross-origin request is unauthenticated first and foremost,
 * and answering it 403 would tell an attacker's page that the victim
 * holds a session on this site — a login-state oracle handed out for
 * free.
 *
 * `no-store` matches every other hand-rolled response on these routes; a
 * cached refusal keyed on a URL that does not vary with `Origin` is its
 * own small bug.
 */
export function refuseIfCrossOrigin(req: Request): Response | null {
  const allowed = allowedOriginsForRequest(req);
  if (isSameOriginRequest(req.headers.get("origin"), req.headers.get("referer"), allowed)) {
    return null;
  }
  return Response.json(
    {
      error: {
        code: "forbidden",
        // Says what to do, names no allowed origin. Echoing the allowlist
        // would turn a refusal into a directory of the deployment's hosts.
        message: "Cross-origin request refused.",
      },
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

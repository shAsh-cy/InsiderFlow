import { unsubscribeByToken } from "@/lib/api/user-queries";
import { getDb } from "@/lib/db";

/**
 * One-click unsubscribe. Reachable without a session (the link lives in an
 * email), so the opaque token IS the credential — it only ever disables
 * email delivery for its owner.
 *
 * GET renders confirmation for a human click; POST satisfies RFC 8058
 * one-click (List-Unsubscribe-Post), which mail providers call directly.
 *
 * ── NO ORIGIN/CSRF GATE HERE. THAT IS A DECISION ──────────────────────
 *
 * `/api/me/*` gained a same-origin allowlist (lib/security/csrf.ts).
 * This route is EXEMPT, deliberately, and the exemption is not an
 * oversight for someone to "fix" later.
 *
 * Two reasons, and the second is the one that bites:
 *
 *   - there is nothing for CSRF to steal. The route is not authenticated
 *     by the session cookie at all; the capability token in the URL is
 *     the entire credential, it is single-use, and the only thing it can
 *     do is stop ITS OWN owner's emails. An attacker who can make a
 *     victim's browser call this already has to know a token, and if
 *     they know the token they can call it themselves from anywhere —
 *     the victim's browser adds nothing;
 *   - the callers are not browsers on our site. `POST` is RFC 8058
 *     one-click, invoked server-to-server by Gmail, Outlook and friends
 *     with no `Origin` and no `Referer`; `GET` is a top-level navigation
 *     from a mail client, which likewise sends no `Origin` and often no
 *     `Referer`. The allowlist refuses a request carrying neither, so
 *     gating this would turn every real unsubscribe into a 403 — the
 *     precise outcome CAN-SPAM and the mail providers' own bulk-sender
 *     rules exist to prevent, and a fast route to being marked a spammer.
 *
 * `e2e/csrf.spec.ts` asserts both methods still work with no `Origin` at
 * all, so a later blanket application of the gate fails a test instead of
 * silently breaking the unsubscribe link.
 */
async function handle(token: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    return await unsubscribeByToken(getDb(), token);
  } catch {
    return false;
  }
}

const page = (ok: boolean): string => `<!doctype html><html><head><meta charset="utf-8">
<title>${ok ? "Unsubscribed" : "Link not recognized"} · InsiderFlow</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0b0f;color:#eef1f8;font-family:system-ui,sans-serif">
<div style="max-width:420px;padding:32px;text-align:center">
<h1 style="font-size:20px;margin:0 0 10px">${ok ? "You're unsubscribed" : "Link not recognized"}</h1>
<p style="color:#96a0b5;font-size:14px;line-height:1.6;margin:0 0 20px">${
  ok
    ? "You will no longer receive InsiderFlow alert emails. Telegram alerts, if you use them, are unaffected — manage everything in settings."
    : "This unsubscribe link is invalid or has already been used."
}</p>
<a href="/settings" style="color:#2de0c8;font-size:14px">Open settings</a>
</div></body></html>`;

export async function GET(req: Request): Promise<Response> {
  const ok = await handle(new URL(req.url).searchParams.get("token"));
  return new Response(page(ok), {
    status: ok ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let token = url.searchParams.get("token");
  if (!token) {
    // Providers may post the token in the body instead of the query.
    const body = await req.text().catch(() => "");
    token = new URLSearchParams(body).get("token");
  }
  const ok = await handle(token);
  return Response.json({ unsubscribed: ok }, { status: ok ? 200 : 404 });
}

/**
 * /.well-known/security.txt — RFC 9116.
 *
 * A route handler rather than a file in `public/`, for one reason:
 * `Expires` is mandatory and must be under a year, so a static file is a
 * document that silently goes stale. Here the date is a named constant
 * with a test that fails while there is still time to renew it, which
 * turns the RFC's expiry from a trap into a reminder.
 *
 * RFC 9116 §2.5.5: a researcher should treat an expired file as no longer
 * valid, which means an expired security.txt is worse than none — it
 * actively tells someone holding a working exploit that nobody is
 * listening.
 */

/** The canonical deployment. Self-hosters: change this to your own. */
const SITE = "https://insiderflow.dev";

/**
 * RFC 9116 §2.5.5 requires this and requires it to be under a year out.
 * `security.txt.test.ts` fails 30 days before it lands, so the renewal is
 * a red build rather than something noticed by a researcher who gave up.
 */
export const SECURITY_TXT_EXPIRES = "2027-08-01T00:00:00.000Z";

const BODY = [
  "# InsiderFlow — security contact (RFC 9116)",
  "#",
  "# Please report vulnerabilities privately. Test against your own local",
  "# instance (`docker compose up`), not a hosted one. Full policy, scope",
  "# and what self-hosters are responsible for: SECURITY.md in the source.",
  "",
  "Contact: mailto:security@insiderflow.dev",
  `Expires: ${SECURITY_TXT_EXPIRES}`,
  `Canonical: ${SITE}/.well-known/security.txt`,
  `Policy: https://github.com/insiderflow/insiderflow/blob/main/SECURITY.md`,
  "Preferred-Languages: en",
  "",
  "# This service is AGPL-3.0. The source is the deployment:",
  "# https://github.com/insiderflow/insiderflow",
  "",
].join("\n");

/**
 * Static. It changes when the source changes and never per request, so
 * there is nothing to recompute and a CDN may hold it.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(BODY, {
    headers: {
      // RFC 9116 §3: the media type is text/plain, and charset=utf-8 is
      // required.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

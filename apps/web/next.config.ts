import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { assertDbEnvOrExit } from "./src/lib/db-env";
import { securityHeadersForNextConfig } from "./src/lib/security/headers";

/**
 * REFUSE TO BUILD A PRODUCTION DEPLOYMENT THAT CANNOT ENFORCE RLS.
 *
 * This runs before anything else in the config, on every `next build`,
 * `next start` and `next dev`, because it is the earliest point in the
 * process that can still say no.
 *
 * The runtime check in `src/lib/db.ts` is the one that actually protects a
 * request, and it is not enough on its own: it fires on the first query, which
 * on a serverless deployment is after the deploy succeeded, the traffic
 * switched over and the old version was retired. Failing the BUILD means the
 * misconfiguration never gets a URL.
 *
 * A build that is not a deployment says so at its own build site with
 * DEPLOY_ENV — see db-env.ts for why the exemption lives there rather than
 * here, and Dockerfile / playwright.config.ts / ci.yml for the three that do.
 */
assertDbEnvOrExit(process.env, {
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  exit: (code) => process.exit(code),
});

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ["@insiderflow/core", "@insiderflow/db"],

  /**
   * No `X-Powered-By: Next.js` on any response.
   *
   * Next defaults this to true, and the r20 leak audit found the header on
   * every response of the production build — it had never been set here, and
   * "we disable it" had been assumed rather than checked.
   *
   * Worth being honest about the size of this: it is version-free, and the
   * framework is obvious from `/_next/static/...` in any page's HTML, so
   * removing it buys very little against a human. What it does remove is a
   * free filter — mass scanners select targets by exactly this header, and
   * being absent from that list is worth one line of config. It is not worth
   * claiming as a defence, and PRODUCTION_READINESS.md does not.
   */
  poweredByHeader: false,

  /**
   * OFF by default, ON for a diagnostic build: `ANALYZE=1 pnpm build`.
   *
   * r17 attributed `/screener`'s 14-point Lighthouse regression to 835ms of
   * script evaluation inside one 170 kB chunk, and could not say WHICH
   * modules were in it, because the chunk is minified and library
   * fingerprints do not survive minification. Naming them needs the source
   * map, and shipping source maps by default would publish the whole
   * unminified source tree to every visitor for the sake of a diagnosis run
   * a few times a year.
   *
   * `scripts/analyze-chunks.mjs` reads what this produces.
   */
  productionBrowserSourceMaps: process.env.ANALYZE === "1",

  /**
   * The constant security headers, on EVERY path.
   *
   * `/:path*` rather than the middleware, because the middleware matcher
   * excludes `/api/*`, `_next/static` and images by design — and `nosniff`
   * on a JSON response and HSTS on a static chunk are precisely the cases
   * worth covering. Content-Security-Policy is not here: it carries a
   * per-request nonce and is set in `middleware.ts`.
   */
  async headers() {
    return [{ source: "/:path*", headers: securityHeadersForNextConfig() }];
  },
};

// Locale comes from a cookie, not the URL — see src/i18n/config.ts for why.
export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);

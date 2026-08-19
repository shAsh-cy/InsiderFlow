import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { securityHeadersForNextConfig } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ["@insiderflow/core", "@insiderflow/db"],

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

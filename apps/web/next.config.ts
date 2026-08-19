import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { securityHeadersForNextConfig } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ["@insiderflow/core", "@insiderflow/db"],

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

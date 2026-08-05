import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ["@insiderflow/core", "@insiderflow/db"],
};

// Locale comes from a cookie, not the URL — see src/i18n/config.ts for why.
export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);

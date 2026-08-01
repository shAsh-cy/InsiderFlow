import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ["@insiderflow/core", "@insiderflow/db"],
};

export default nextConfig;

import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests. Install browsers once: pnpm exec playwright install chromium
 *
 * By default Playwright boots its own dev server. To run against an
 * already-running instance (e.g. a production build on :3100), set
 * PLAYWRIGHT_BASE_URL and the managed webServer is skipped.
 */
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseUrl ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});

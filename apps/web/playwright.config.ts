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
  /**
   * Two projects, because one test measures the MACHINE.
   *
   * The 10k-row scroll asserts a frame budget. Run alongside seven other
   * Chromium instances on the same box it measures how oversubscribed the
   * CPU is, which is a true fact about the runner and no fact at all
   * about the product — it failed under eight workers and passed alone,
   * every time. Loosening the budget to accommodate that would delete the
   * only thing the test is for.
   *
   * So the perf test runs in its own project, gated behind the rest via
   * `dependencies`. By the time it starts, nothing else is running and
   * the number means what it claims to.
   */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /60fps/,
    },
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      grep: /60fps/,
      fullyParallel: false,
      dependencies: ["chromium"],
    },
  ],
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

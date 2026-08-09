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
      grepInvert: /60fps|@mobile|@stream/,
    },
    /**
     * The mobile matrix.
     *
     * Every test in the r3 suite ran at 1280x720 — no `setViewportSize`, no
     * device descriptor, no `hasTouch` anywhere — so 140 tests only ever
     * exercised the >=1024px branch of every responsive rule. The sidebar was
     * always visible and no mobile layout was executed even once.
     *
     * `hasTouch` and `isMobile` are the load-bearing part, not the viewport:
     * they are what makes `(hover: hover) and (pointer: fine)` evaluate false,
     * which is the condition every hover-gated affordance in this product is
     * written against. A narrow desktop window is not a phone, and testing one
     * as though it were the other is how the touch path stays broken.
     *
     * Specs opt in with `@mobile` in their title; `chromium` excludes the same
     * tag so nothing runs twice.
     */
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
      grep: /@mobile/,
      grepInvert: /60fps|@stream/,
    },
    /**
     * The live-stream tests, for the same reason as `perf` and a different
     * shared resource.
     *
     * `/api/stream` caps concurrent SSE connections at four per IP, and
     * every worker on this box is the same IP. Two tests need a real
     * connection AND a row to arrive over it; run beside seven other
     * workers they were starved by a limit that is the product working as
     * designed, and they had been carrying `retries: 2` to paper over it.
     * A retry that exists to survive the suite's own contention is a test
     * that has stopped measuring the product.
     *
     * So they run alone, after everything else. The retries are gone with
     * the contention, and a failure here means something is actually wrong.
     */
    {
      name: "stream",
      use: { ...devices["Desktop Chrome"] },
      grep: /@stream/,
      fullyParallel: false,
      workers: 1,
      dependencies: ["chromium", "mobile"],
    },
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      grep: /60fps/,
      fullyParallel: false,
      dependencies: ["stream"],
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

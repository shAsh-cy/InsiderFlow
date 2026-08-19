import { expect, test } from "@playwright/test";

/**
 * Ship-readiness acceptance: health, status, legal, the footer disclaimer, and
 * the honest congressional-coverage banner.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm exec playwright test e2e/ship.spec.ts
 */

test.describe("health endpoint", () => {
  test("reports ingestion lag, per-source freshness, and counts", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    // A cached health check is a lie with a TTL.
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = (await response.json()) as {
      status: string;
      checkedAt: string;
      checks: Array<{ name: string; level: string; detail: string }>;
      sources: Array<{ source: string; rows: number }>;
      counts: Record<string, number>;
    };

    expect(["ok", "degraded"]).toContain(body.status);
    expect(Date.parse(body.checkedAt)).toBeGreaterThan(0);

    const names = body.checks.map((c) => c.name);
    expect(names).toContain("ingest_cron");
    expect(names).toContain("edgar_filings");
    expect(names).toContain("alert_scanner");

    // Every check must explain itself — a bare level is not actionable.
    for (const check of body.checks) {
      expect(check.detail.length, check.name).toBeGreaterThan(10);
      expect(["ok", "degraded", "unknown"]).toContain(check.level);
    }

    expect(body.counts).toHaveProperty("transactions");
    expect(body.counts).toHaveProperty("alertsPending");
    expect(Array.isArray(body.sources)).toBe(true);
  });

  test("stays 200 while the site serves, even when jobs are behind", async ({ request }) => {
    // 503 is reserved for "the database is unreachable". An uptime monitor
    // should page for the site being down, not for EDGAR being quiet.
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
  });
});

test.describe("status page", () => {
  test("shows live ingestion lag and per-source freshness", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();
    await expect(page.getByTestId("status-summary")).toBeVisible();

    const checks = page.getByTestId("status-checks");
    await expect(checks).toContainText("ingest_cron");
    await expect(checks).toContainText("alert_scanner");
    // EDGAR's business-day schedule is explained rather than alarming.
    await expect(checks).toContainText(/business days only|Newest filing|No filings/);

    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data" })).toBeVisible();
  });

  test("links to the machine-readable endpoint", async ({ page }) => {
    await page.goto("/status");
    await page.getByRole("link", { name: "/api/health" }).click();
    await expect(page).toHaveURL(/\/api\/health/);
  });
});

test.describe("legal page", () => {
  test("covers every data source and its terms", async ({ page }) => {
    await page.goto("/legal");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Legal");

    for (const id of ["sec", "stock-act", "india", "market-data", "analytics", "licence"]) {
      await expect(page.locator(`#${id}`), id).toBeAttached();
    }

    // The specific obligations that must be stated, not merely gestured at.
    await expect(page.getByText(/public domain/i).first()).toBeVisible();
    await expect(page.getByText(/fair.access/i).first()).toBeVisible();
    await expect(page.getByText(/Information Technology Act/i)).toBeVisible();
    await expect(page.getByText(/STOCK Act|Stock Act/).first()).toBeVisible();
    await expect(page.getByText(/Amounts are ranges/i)).toBeVisible();
    await expect(page.getByText(/AGPL/i).first()).toBeVisible();
  });

  test("states the disclaimer prominently, not in fine print", async ({ page }) => {
    await page.goto("/legal");
    await expect(page.getByText("Not investment advice.").first()).toBeVisible();
    await expect(page.getByText(/not a broker-dealer/i)).toBeVisible();
  });
});

test.describe("footer disclaimer", () => {
  /**
   * Accepts either phrasing in either locale. The substance is what matters —
   * "investment advice" negated — not one exact sentence, and an assertion
   * pinned to one wording would fail on a legitimate rewording while still
   * passing on a page whose disclaimer had been deleted and replaced with the
   * same words in a different context.
   */
  const DISCLAIMER =
    /(not investment advice|nothing on this site is investment advice|निवेश सलाह नहीं)/i;

  // Any page can be someone's entry point from a search result or a shared
  // link, so the disclaimer cannot live only on the landing page.
  for (const path of ["/", "/trades", "/screener", "/heatmap", "/leaderboard", "/politicians"]) {
    test(`is present on ${path}`, async ({ page }) => {
      await page.goto(path);
      const footer = page.getByTestId("footer-disclaimer");
      await expect(footer).toBeVisible();
      await expect(footer).toContainText(DISCLAIMER);
    });
  }

  test("links to the legal page from the app shell", async ({ page }) => {
    await page.goto("/trades");
    await page.getByRole("link", { name: /Legal & data sources/i }).click();
    await expect(page).toHaveURL(/\/legal/);
  });
});

test.describe("locale / session cache safety", () => {
  /**
   * The invariant that actually prevents one visitor's Hindi (or signed-in)
   * page reaching another. A `Vary: Cookie` header cannot be relied on — Next
   * rewrites Vary to its RSC negotiation headers — so what is asserted here is
   * the stronger property: HTML is never storable by a shared cache.
   *
   * If someone makes a page shared-cacheable, this fails and forces them to
   * deal with the locale cookie first.
   */
  for (const path of ["/", "/trades", "/politicians", "/leaderboard"]) {
    test(`HTML is never shared-cacheable: ${path}`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const cacheControl = (response.headers()["cache-control"] ?? "").toLowerCase();
      expect(cacheControl, `${path} must not be shared-cacheable`).toMatch(/private|no-store/);
      expect(cacheControl).not.toMatch(/\bs-maxage=[1-9]/);
    });
  }

  test("API responses stay shared-cacheable and locale-agnostic", async ({ request }) => {
    // The other half of the trade-off: data endpoints MUST stay cacheable, so
    // they must not be localized and must not vary by cookie.
    const [en, hi] = await Promise.all([
      request.get("/api/trades?limit=2", { headers: { cookie: "insiderflow-locale=en" } }),
      request.get("/api/trades?limit=2", { headers: { cookie: "insiderflow-locale=hi" } }),
    ]);
    expect(en.status()).toBe(200);
    expect(hi.status()).toBe(200);
    expect(await en.text()).toBe(await hi.text());

    const cacheControl = (en.headers()["cache-control"] ?? "").toLowerCase();
    expect(cacheControl).toContain("s-maxage");
    expect((en.headers()["vary"] ?? "").toLowerCase()).not.toContain("cookie");
  });
});

test.describe("synthetic-data honesty", () => {
  test("an aggregate showing fixtures says so", async ({ page }) => {
    // Aggregates exclude the ZZ* namespace by default. When a deployment opts
    // in (docker compose does, so the seeded stack is not all empty charts),
    // the page must admit it — an unlabelled chart built from fixtures is
    // exactly the screenshot that gets mistaken for real market data.
    await page.goto("/heatmap");
    const notice = page.getByTestId("synthetic-notice");

    if (await notice.isVisible()) {
      await expect(notice).toContainText(/synthetic seed data/i);
      await expect(notice).toContainText(/[Nn]ot market data/);
    } else {
      // Not opted in: no ZZ* ticker may appear in the aggregate at all.
      const body = (await page
        .locator("table")
        .innerText()
        .catch(() => "")) as string;
      expect(body, "aggregates must exclude ZZ* fixtures by default").not.toMatch(/\bZZ[A-Z]/);
      // REMOVED in r12: `expect(rows).toBeGreaterThanOrEqual(0)`. A row
      // count is a non-negative integer, so that assertion was true for
      // every possible value of the thing it named — it could not fail,
      // and it read as coverage of the not-opted-in branch. The real
      // claim is the one above: no synthetic ticker reaches an aggregate.
    }
  });
});

test.describe("congressional coverage honesty", () => {
  test("states what data is actually held, or that there is none", async ({ page }) => {
    await page.goto("/politicians");
    const banner = page.getByTestId("politician-coverage");
    await expect(banner).toBeVisible();

    // Either shape is correct — what must never happen is an empty table with
    // no explanation, which is indistinguishable from a broken pipeline.
    await expect(banner).toContainText(
      /Data through \d{4}-\d{2}-\d{2}|No congressional disclosures ingested/,
    );
  });
});

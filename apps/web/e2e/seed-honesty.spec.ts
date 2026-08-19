import { expect, test } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticFiling,
  insertSyntheticPoliticianTrade,
  insertSyntheticSastDisclosure,
  insertSyntheticTrade,
  supersedeFiling,
} from "./fixtures";
import type { SyntheticCompany } from "./fixtures";

/**
 * The seed's own honesty, and the India panels it never populated.
 *
 * docs/architecture.md states the invariant plainly: **a missing value is
 * never a zero.** The renderers always obeyed it. The FIXTURE did not — it
 * wrote a stock grant with `price: 0`, which surfaced as "at USD 0" in RSS and
 * a $0 column on the stock page. Synthetic and namespaced, so it could not be
 * mistaken for a real filing, but it is the first example every contributor
 * reads and it contradicted the project's headline promise.
 *
 * The India panels shipped with zero seeded rows, so all three rendered their
 * empty state and the whole feature was unprovable from a clean start. "The
 * schema exists" and "the feature works" are different claims, and only one of
 * them is testable.
 *
 * ── ADVERSARIAL CASES (r15) ───────────────────────────────────────────
 *
 * Everything above reads the SEED, and the seed is co-operative: its nulls
 * are null and its brackets are wide. A data-honesty rule is only worth
 * anything at the values where it is expensive to obey, so the describes
 * below write those values in on purpose and then read the page back.
 *
 * The four are chosen because each has a plausible wrong implementation
 * that the happy path cannot see: coalescing NULL to 0 (identical output
 * for the seed, which has no zeros), collapsing a degenerate bracket to a
 * point (identical output for the seed, whose brackets are all wide),
 * deleting a superseded row instead of hiding it (identical output for the
 * seed, which nobody amends), and dropping the synthetic gate (identical
 * output on a deployment that has opted in — which this one has).
 *
 * Run against the compose stack:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/seed-honesty.spec.ts
 */

test.describe("a grant has no price, and says so", () => {
  test("the API returns null rather than zero", async ({ request }) => {
    const response = await request.get("/api/trades?ticker=ZZNOVA&code=A&limit=10");
    const body = (await response.json()) as {
      data: Array<{ code: string; price: number | null; value: number | null }>;
    };
    expect(
      body.data.length,
      "the seed must contain a grant to make this meaningful",
    ).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.price, "a grant has no purchase price").toBeNull();
      expect(row.value, "and therefore no value").toBeNull();
    }
  });

  test("RSS never prints a fabricated zero price", async ({ request }) => {
    const body = await (await request.get("/api/rss/latest")).text();
    // The exact string the seeded grant used to produce.
    expect(body).not.toContain("at USD 0 ");
    expect(body).not.toMatch(/at [A-Z]{3} 0\b/);
  });

  test("no seeded transaction carries a zero price or value", async ({ request }) => {
    // Belt and braces across the whole fixture set, not just the grant: a
    // zero that means "not disclosed" is the failure mode, wherever it appears.
    const response = await request.get("/api/trades?limit=100");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ code: string; price: number | null; value: number | null }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.price, `${row.code} price`).not.toBe(0);
      expect(row.value, `${row.code} value`).not.toBe(0);
    }
  });
});

test.describe("India disclosures render from the seed", () => {
  test("all three panels show rows, not empty states", async ({ page }) => {
    await page.goto("/stock/ZZBHARAT");

    const sast = page.getByRole("region", { name: /SAST disclosures/i });
    await expect(sast).toBeVisible();
    await expect(sast.getByRole("row")).not.toHaveCount(1); // header only = empty
    await expect(sast).toContainText("ZZ Kaveri Holdings");

    const deals = page.getByRole("region", { name: /bulk|block/i }).first();
    await expect(deals).toBeVisible();
    await expect(deals).toContainText("ZZ Sundara Asset Management");

    const pledges = page.getByRole("region", { name: /pledge/i }).first();
    await expect(pledges).toBeVisible();
    await expect(pledges).toContainText("ZZ Bharat Promoter Family Trust");

    // None of the three may be showing its "no rows" copy.
    await expect(page.getByText(/No .* on record/)).toHaveCount(0);
  });

  test("a SAST filing with no disclosed consideration says so rather than inventing one", async ({
    page,
  }) => {
    // SEBI Reg. 29 requires the SHAREHOLDING, not the consideration. Most
    // filings carry no value, and deriving one — shares x yesterday's close —
    // would publish a number nobody filed.
    await page.goto("/stock/ZZBHARAT");
    const sast = page.getByRole("region", { name: /SAST disclosures/i });
    const kaveriRow = sast.getByRole("row").filter({ hasText: "ZZ Kaveri Holdings" });
    await expect(kaveriRow).toHaveCount(1);
    await expect(kaveriRow).not.toContainText(/₹\s*0\b|INR 0\b|\$0\b/);
  });
});

/**
 * Column order in the SAST panel, which is the panel's own contract — the
 * header row reads Date / Acquirer / Reg. / Side / Shares / % after / Mode
 * / Value. Addressed by position because the assertion below is about ONE
 * cell's rendered text, and matching the cell on its text would beg the
 * question the test is asking.
 */
const SAST_PCT_AFTER_CELL = 5;
const SAST_VALUE_CELL = 7;

test.describe("a disclosed zero is a figure, an undisclosed one is not", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZZERO", { country: "IN" });

    // An inter-se promoter transfer at nil consideration, after which the
    // transferor holds nothing. Both zeros are FILED FACTS, and the second
    // one — a promoter at 0% — is among the most material things a SAST
    // disclosure can say. Rendering either as "—" would report a promoter
    // exit as an administrative gap.
    insertSyntheticSastDisclosure(target, {
      acquirerName: "ZZ Nil Consideration Trust",
      tag: "zero",
      shares: 250_000,
      sharesPctAfter: 0,
      value: 0,
      valueUsd: 0,
      daysAgo: 3,
    });

    // The ordinary Reg. 29 case: shareholding disclosed, consideration not.
    insertSyntheticSastDisclosure(target, {
      acquirerName: "ZZ Undisclosed Consideration LLP",
      tag: "null",
      shares: 250_000,
      sharesPctAfter: null,
      value: null,
      valueUsd: null,
      daysAgo: 4,
    });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("renders the two differently, cell for cell", async ({ page }) => {
    await page.goto(`/stock/${target.ticker}`);
    const sast = page.getByRole("region", { name: /SAST disclosures/i });
    await expect(sast).toBeVisible();

    const filed = sast.getByRole("row").filter({ hasText: "ZZ Nil Consideration Trust" });
    const absent = sast.getByRole("row").filter({ hasText: "ZZ Undisclosed Consideration LLP" });
    await expect(filed).toHaveCount(1);
    await expect(absent).toHaveCount(1);

    // A filed zero prints as the number it is, in both the percentage and
    // the money column, and never borrows the null glyph's label.
    await expect(filed.getByRole("cell").nth(SAST_PCT_AFTER_CELL)).toHaveText("0%");
    await expect(filed.getByRole("cell").nth(SAST_VALUE_CELL)).toContainText("₹0");
    await expect(filed.getByRole("cell").nth(SAST_VALUE_CELL)).not.toContainText("Not disclosed");

    // An absent figure gets the glyph AND the sentence a screen reader
    // hears — the glyph alone is indistinguishable from a blank cell.
    await expect(absent.getByRole("cell").nth(SAST_PCT_AFTER_CELL)).toContainText(
      "Not disclosed in the filing",
    );
    await expect(absent.getByRole("cell").nth(SAST_VALUE_CELL)).toContainText(
      "Not disclosed in the filing",
    );
    // And no digit anywhere in either cell: a "0" here IS the conflation.
    await expect(absent.getByRole("cell").nth(SAST_PCT_AFTER_CELL)).not.toContainText(/\d/);
    await expect(absent.getByRole("cell").nth(SAST_VALUE_CELL)).not.toContainText(/\d/);

    // The invariant stated once as itself, because the assertions above
    // could each be relaxed one day without anyone noticing that they had
    // stopped saying anything jointly.
    const filedValue = await filed.getByRole("cell").nth(SAST_VALUE_CELL).textContent();
    const absentValue = await absent.getByRole("cell").nth(SAST_VALUE_CELL).textContent();
    expect(filedValue, "a filed zero and an undisclosed value must not read alike").not.toBe(
      absentValue,
    );
  });
});

test.describe("a bracket with equal bounds is still a bracket", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZRNGE");
    insertSyntheticTrade(target, { ingestedDaysAgo: 3 });

    // `amountRange: null` is the load-bearing half. With the verbatim label
    // present the UI only echoes it and no collapse is possible; without it
    // the bracket is REBUILT from the bounds, which is the code path where
    // `min === max ? one number : two` is the tempting simplification.
    insertSyntheticPoliticianTrade(target, {
      amountMin: 1000,
      amountMax: 1000,
      amountRange: null,
    });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("the API keeps both bounds and still publishes no point value", async ({ request }) => {
    const response = await request.get(`/api/politicians?ticker=${target.ticker}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };

    expect(body.data).toHaveLength(1);
    const row = body.data[0]!;
    expect(row.amountMin, "the lower bound survives").toBe(1000);
    expect(row.amountMax, "and so does the upper one, equal or not").toBe(1000);
    // Equal bounds are the one case where a single figure would be
    // "obviously" safe to publish. It is still a number no filing contains.
    expect(row).not.toHaveProperty("value");
    expect(row).not.toHaveProperty("amount");
    expect(row).not.toHaveProperty("valueUsd");
  });

  test("the table prints both bounds rather than one number", async ({ page }) => {
    await page.goto(`/politicians?ticker=${target.ticker}`);
    const row = page.getByRole("row", { name: new RegExp(target.ticker) });
    await expect(row).toHaveCount(1);

    // Exact text, not containment: "$1,000" is a substring of "$1,000–$1,000",
    // so a contains-check would pass on the collapsed rendering this test
    // exists to reject. Column 3 is "Amount (range)".
    await expect(row.getByRole("cell").nth(3)).toHaveText("$1,000–$1,000");
  });
});

test.describe("a superseded filing is hidden, not deleted", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZAMND");
    const original = insertSyntheticFiling(target, { formType: "4", tag: "orig", filedDaysAgo: 4 });
    const amendment = insertSyntheticFiling(target, {
      formType: "4/A",
      tag: "amd",
      filedDaysAgo: 1,
    });

    // The row the amendment replaced…
    //
    // No `tag`: a tagged dedup key is `e2e-<tag>-<shares>#0` with no ticker
    // in it, so four workers running this file share one key and three of
    // their inserts are swallowed by ON CONFLICT DO NOTHING. Untagged, the
    // key carries the (unique) fixture ticker and the share counts alone
    // keep the two rows apart.
    insertSyntheticTrade(target, { shares: 111, filingId: original, ingestedDaysAgo: 3 });
    // …and a row on a filing nothing replaced. Without it, "the default view
    // is empty" and "the filter works" would be the same observation, and a
    // query that returned nothing at all would pass.
    insertSyntheticTrade(target, { shares: 222, filingId: amendment, ingestedDaysAgo: 3 });

    supersedeFiling(original, amendment);
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  test("the API omits the superseded row by default", async ({ request }) => {
    const response = await request.get(`/api/trades?ticker=${target.ticker}&limit=10`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ shares: number | null; filing: { superseded: boolean } | null }>;
    };

    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.shares, "the surviving row is the amendment's").toBe(222);
    expect(body.data[0]!.filing?.superseded).toBe(false);
  });

  test("and returns it, marked as replaced, when asked for explicitly", async ({ request }) => {
    const response = await request.get(
      `/api/trades?ticker=${target.ticker}&limit=10&include_superseded=true`,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ shares: number | null; filing: { superseded: boolean } | null }>;
    };

    expect(body.data).toHaveLength(2);
    const replaced = body.data.find((r) => r.shares === 111);
    expect(replaced, "hidden by default must not mean gone from the record").toBeDefined();
    // Reachable AND labelled. Serving an amended row unlabelled would be
    // worse than hiding it — the reader would have no way to tell.
    expect(replaced!.filing?.superseded).toBe(true);
  });

  test("the stock page hides it until the amendments toggle is used", async ({ page }) => {
    await page.goto(`/stock/${target.ticker}`);
    const history = page.getByRole("region", { name: `Insider trades for ${target.ticker}` });

    await expect(history.getByRole("row").filter({ hasText: "222" })).toHaveCount(1);
    await expect(history.getByRole("row").filter({ hasText: "111" })).toHaveCount(0);

    await page.getByTestId("amendments-toggle").click();
    await expect(page).toHaveURL(/amendments=1/);

    const withAmendments = page.getByRole("region", {
      name: `Insider trades for ${target.ticker}`,
    });
    const replaced = withAmendments.getByRole("row").filter({ hasText: "111" });
    await expect(replaced).toHaveCount(1);
    await expect(replaced).toContainText("superseded");
  });
});

test.describe("an aggregate that includes fixtures says so", () => {
  let target: SyntheticCompany;

  test.beforeAll(() => {
    target = createSyntheticCompany("ZZAGGR");
    insertSyntheticTrade(target, { shares: 4000, price: 250, ingestedDaysAgo: 2 });
  });

  test.afterAll(() => {
    cleanupSyntheticCompany(target);
  });

  /**
   * This deployment runs INSIDERFLOW_SHOW_SYNTHETIC=true — the documented
   * local configuration, and the one the rest of the suite depends on. So
   * the invariant testable over HTTP here is not "ZZ* is absent"; it is the
   * promise the opt-in makes in exchange: an aggregate carrying fabricated
   * rows has to admit it, on the page, in words.
   *
   * The exclusion itself lives in `excludeSynthetic()` and no request to
   * this server can turn it on; it is covered against real rows in
   * packages/db/src/synthetic-scope.test.ts.
   */
  test("the heatmap carries the fixture and the notice together", async ({ page, request }) => {
    const response = await request.get("/api/heatmap?group_by=company&timeframe=30d&limit=200");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { data: Array<{ ticker: string | null }> };
    expect(
      body.data.some((cell) => cell.ticker === target.ticker),
      "precondition: the fixture must really be inside the aggregate, or the notice captions nothing",
    ).toBe(true);

    await page.goto("/heatmap");
    const notice = page.getByTestId("synthetic-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("ZZ*");
    await expect(notice).toContainText(/Not market data/i);
  });

  test("and a trade-level screen does not, because nothing is aggregated there", async ({
    page,
  }) => {
    // The negative control, and the rule itself: ZZ* on /trades is the
    // supported smoke-test path, so a caveat there would be noise — and
    // noise is what teaches a reader to skip the one on /heatmap.
    await page.goto("/trades");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("synthetic-notice")).toHaveCount(0);
  });
});

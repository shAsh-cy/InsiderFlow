import { test, expect } from "@playwright/test";

/**
 * THE LANDING FOOTER (r6).
 *
 * Two different jobs, deliberately not merged:
 *
 *   `SiteFooter`, on every app route, exists so "not investment advice"
 *   appears on any page that can be somebody's entry point from a search
 *   result. That is unchanged.
 *
 *   This one is the landing page saying what the project IS — licence,
 *   source, build. The source link is a licence term rather than a
 *   courtesy: AGPL-3.0 §13 requires that users interacting with the
 *   software over a network are offered the Corresponding Source through
 *   the interface itself.
 */

test.describe("the landing footer", () => {
  test("offers the source and the licence, as AGPL-3.0 §13 requires", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("[data-content-region] footer");
    await expect(footer).toBeVisible();

    const source = footer.getByRole("link", { name: /^source$/i });
    await expect(source).toHaveAttribute("href", /github\.com/);
    await expect(source).toHaveAttribute("target", "_blank");
    // `noreferrer` implies `noopener`: a target=_blank without it hands the
    // opened page a handle on this one.
    await expect(source).toHaveAttribute("rel", /noreferrer/);

    const licence = footer.getByRole("link", { name: /licence \(AGPL-3\.0\)/i });
    await expect(licence).toHaveAttribute("href", /agpl-3\.0/);
  });

  test("its internal links all resolve", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("[data-content-region] footer");
    const hrefs = await footer
      .locator("a[href^='/']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
    expect(hrefs.length, "internal links present").toBeGreaterThanOrEqual(7);
    for (const href of hrefs) {
      const res = await page.goto(href);
      expect(res?.status(), `${href} should resolve`).toBe(200);
    }
  });

  test("prints a build string, and no commit it does not have", async ({ page }) => {
    await page.goto("/");
    const build = page.getByTestId("build-string");
    await expect(build).toBeVisible();
    const text = (await build.textContent())!;
    // A version, optionally a real short SHA, and the licence. Never
    // "dev", never a zeroed hash — a fabricated build id is the same class
    // of mistake as a fabricated zero in a filing.
    expect(text, `build string was "${text}"`).toMatch(
      /^v\d+\.\d+\.\d+( · [0-9a-f]{7})? · AGPL-3\.0$/,
    );
    const font = await build.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font, "a version string is set in the mono face").toMatch(/plex mono/i);
  });

  test("the disclaimer moved out of the hero and is still on the page", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("[data-content-region] > section").first();
    // It used to be a bordered `role="alert"` block directly under the
    // primary call to action — announced on load by every screen reader,
    // and the fourth thing between the headline and the product.
    await expect(hero.locator("[role='alert']")).toHaveCount(0);
    await expect(hero).not.toContainText(/not investment advice/i);

    const footer = page.getByTestId("footer-disclaimer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/not investment advice/i);
    // Provenance travels with it: what the data is and where it came from.
    await expect(footer).toContainText(/SEC EDGAR/i);
  });

  test("the index is four groups and uses the whole shell width", async ({ page }) => {
    // r6 put every link in one narrow left-hand column, which at 1920 left
    // the right two thirds of the band empty — a footer that had stopped
    // using the page it sits on.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/");
    const footer = page.locator("[data-content-region] footer");

    for (const group of ["Product", "Project", "Reference"]) {
      await expect(
        footer.getByRole("navigation", { name: group }),
        `the ${group} group`,
      ).toBeVisible();
    }
    // The brand column is a column of the grid, not a banner above it.
    await expect(footer.getByText("The real-time insider-trading tape")).toBeVisible();

    const spread = await page.evaluate(() => {
      const foot = document.querySelector("[data-content-region] footer")!;
      const grid = foot.firstElementChild!;
      const cols = Array.from(grid.children).map((c) => c.getBoundingClientRect());
      const box = grid.getBoundingClientRect();
      return {
        columns: cols.length,
        rows: new Set(cols.map((c) => Math.round(c.y))).size,
        // How far the rightmost column reaches across the band.
        reach: (Math.max(...cols.map((c) => c.right)) - box.x) / box.width,
      };
    });
    expect(spread.columns, "four columns").toBe(4);
    expect(spread.rows, "on one row at 1920").toBe(1);
    expect(spread.reach, "the grid must not stop half way").toBeGreaterThan(0.95);
  });

  test("the index collapses 4 to 2 to 1", async ({ page }) => {
    await page.goto("/");
    const rowsAt = async (width: number) => {
      await page.setViewportSize({ width, height: 1000 });
      return page.evaluate(() => {
        const grid = document.querySelector("[data-content-region] footer")!.firstElementChild!;
        const tops = Array.from(grid.children).map((c) => Math.round(c.getBoundingClientRect().y));
        return new Set(tops).size;
      });
    };
    expect(await rowsAt(1440), "four across on a desktop").toBe(1);
    expect(await rowsAt(800), "two by two on a tablet").toBe(2);
    expect(await rowsAt(390), "one column on a phone").toBe(4);
  });

  test("the fine print keeps a measure, and the bands are ruled apart", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/");
    const band = page.getByTestId("footer-disclaimer");
    const measured = await band.evaluate((el) => {
      const paras = Array.from(el.querySelectorAll("p"));
      return {
        widths: paras.map((p) => p.getBoundingClientRect().width),
        bandWidth: el.getBoundingClientRect().width,
        rule: getComputedStyle(el).borderTopWidth,
        ruleColour: getComputedStyle(el).borderTopColor,
      };
    });
    // Full-width band, capped paragraphs. At 1920 the band is ~1790px and a
    // 66ch line is nowhere near it — that gap is the whole point.
    expect(measured.bandWidth).toBeGreaterThan(1000);
    for (const w of measured.widths) {
      expect(w, `fine-print line is ${Math.round(w)}px`).toBeLessThan(760);
    }
    expect(parseFloat(measured.rule), "the fine print is ruled off").toBeGreaterThan(0);
    expect(measured.ruleColour).not.toBe("rgba(0, 0, 0, 0)");

    const metaRule = await page
      .getByTestId("build-string")
      .evaluate((el) => getComputedStyle(el.parentElement!).borderTopWidth);
    expect(parseFloat(metaRule), "the build row is ruled off too").toBeGreaterThan(0);
  });

  test("app routes keep their own footer and do not get this one", async ({ page }) => {
    for (const route of ["/trades", "/leaderboard"]) {
      await page.goto(route);
      // The disclaimer is still there — that rule is not what changed.
      await expect(page.getByTestId("footer-disclaimer")).toContainText(/not investment advice/i);
      // …but the project-identity footer belongs to the landing page.
      await expect(
        page.getByTestId("build-string"),
        `${route}: the build string is a landing-page statement`,
      ).toHaveCount(0);
    }
  });
});

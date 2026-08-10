import { test, expect } from "@playwright/test";

/**
 * THE LANDING FOOTER.
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
 *
 * ── r8 AMENDMENT: THE BAND FILLS THE SHELL ─────────────────────────────
 *
 * The layout assertions here are amended rather than extended, because the
 * contract they encode changed. The lineage, kept with the tests that
 * enforce it so a ninth revision does not have to guess:
 *
 *   r4 — LEFT-HUG. Everything pinned to the viewport's left edge.
 *        Rejected: "tons of space on the right".
 *   r5 — CENTRED SHELL at 88rem, which centred the chrome with it.
 *   r6 — UNIFIED EDGE. Chrome and content share one left edge, and the
 *        footer became an index instead of a flat list.
 *   r7 — FLUID TIGHTER GUTTER, one `--shell-gutter` for every shell, and
 *        a masthead with a drawn ground and hairline.
 *   r8 — THE BAND FILLS THE SHELL. The fine print was one ≤66ch column
 *        against the left gutter, leaving most of a 1792px band empty.
 *        66ch was the right principle read off the wrong line: it is
 *        Bringhurst's figure for a SINGLE column, and he gives 40–50 for
 *        multi-column setting. So it is two 1fr tracks reaching both
 *        gutters, each paragraph at a multi-column measure inside its own
 *        track, stacking below 768. The brand column left the index — it
 *        repeated the masthead — and the mark is now a compact glyph in
 *        the meta row beside the version.
 *
 * What changed is the SHAPE of the band. What has not changed, and is
 * still asserted below: the disclaimer is in the footer and not the hero,
 * every link resolves, the source and licence are offered, and the build
 * string never invents a commit it does not have.
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
    // Read below in ONE evaluate with the existence check. Asserting
    // visibility and then reading `getComputedStyle` in a second round trip
    // is a race: hydration can replace the node in between, and
    // `getComputedStyle` on a detached node returns empty strings — which
    // reads as "the version string is not in the mono face" rather than as
    // "it was measured on a node that is no longer in the document". This
    // file lost that race on the r8 baseline run.
    // A version, optionally a real short SHA, and the licence. Never
    // "dev", never a zeroed hash — a fabricated build id is the same class
    // of mistake as a fabricated zero in a filing.
    expect(text, `build string was "${text}"`).toMatch(
      /^v\d+\.\d+\.\d+( · [0-9a-f]{7})? · AGPL-3\.0$/,
    );
    const font = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='build-string']");
      return el ? getComputedStyle(el).fontFamily : null;
    });
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

  // AMENDED in r8 — see the lineage at the top of this file.
  for (const width of [1280, 1440, 1920]) {
    test(`the fine print is two columns filling the shell at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const measured = await page.evaluate(() => {
        const el = document.querySelector("[data-testid='footer-disclaimer']")!;
        const band = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const paras = Array.from(el.querySelectorAll("p")).map((p) => {
          const r = p.getBoundingClientRect();
          const fs = parseFloat(getComputedStyle(p).fontSize);
          return { x: r.x, right: r.right, width: r.width, fontSize: fs };
        });
        return {
          band: { x: band.x, right: band.right, width: band.width },
          tracks: s.gridTemplateColumns.split(" ").filter(Boolean).length,
          gap: parseFloat(s.columnGap),
          rule: parseFloat(s.borderTopWidth),
          ruleColour: s.borderTopColor,
          paras,
        };
      });

      // Two tracks, side by side, and the pair reaches both gutters.
      expect(measured.tracks, "two columns").toBe(2);
      expect(measured.paras.length).toBe(2);
      expect(measured.paras[0]!.x, "first column starts at the band's edge").toBeCloseTo(
        measured.band.x,
        0,
      );

      // THE r8 CLAIM. r7 left the whole right half of the band empty; the
      // second paragraph must now begin at or past the midpoint, which is
      // what makes this a band rather than a column with a hole beside it.
      const midpoint = measured.band.x + measured.band.width / 2;
      expect(
        measured.paras[1]!.x,
        `second column starts at ${Math.round(measured.paras[1]!.x)}, midpoint is ${Math.round(midpoint)}`,
      ).toBeGreaterThanOrEqual(midpoint - 1);

      // …and each column is still set to a MULTI-column measure. 50ch is
      // Bringhurst's upper bound for columns; 66ch is his single-column
      // figure and is what r7 mistakenly used here.
      for (const p of measured.paras) {
        const ch = p.width / (p.fontSize * 0.5);
        expect(p.width, `column is ${Math.round(p.width)}px wide`).toBeLessThan(560);
        expect(ch, `column measures ~${Math.round(ch)}ch`).toBeLessThan(105);
      }

      // A column gap that is a gap, not a coincidence.
      expect(measured.gap, "the columns are separated by the band token").toBeGreaterThanOrEqual(
        24,
      );
      expect(measured.gap).toBeLessThanOrEqual(48);

      expect(measured.rule, "the fine print is ruled off").toBeGreaterThan(0);
      expect(measured.ruleColour).not.toBe("rgba(0, 0, 0, 0)");
    });
  }

  test("the fine print stacks to one column below 768", async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 1000 });
    await page.goto("/");
    const rows = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='footer-disclaimer']")!;
      const tops = Array.from(el.querySelectorAll("p")).map((p) =>
        Math.round(p.getBoundingClientRect().y),
      );
      return new Set(tops).size;
    });
    expect(rows, "two paragraphs, two rows").toBe(2);
  });

  test("the meta row spans the shell and is ruled off", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/");
    const meta = await page.evaluate(() => {
      const version = document.querySelector("[data-testid='build-string']")!;
      const row = version.parentElement!;
      const footer = document.querySelector("[data-content-region] footer")!;
      const r = row.getBoundingClientRect();
      const f = footer.getBoundingClientRect();
      return {
        rule: parseFloat(getComputedStyle(row).borderTopWidth),
        left: r.x,
        right: r.right,
        footerLeft: f.x,
        footerRight: f.right,
      };
    });
    expect(meta.rule, "the build row is ruled off too").toBeGreaterThan(0);
    // Full shell width: the row is a band, not a caption under one column.
    expect(
      Math.abs(meta.left - meta.footerLeft),
      "meta row starts at the shell edge",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(meta.right - meta.footerRight),
      "meta row reaches the far gutter",
    ).toBeLessThanOrEqual(1);
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

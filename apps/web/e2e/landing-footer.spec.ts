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
 * ── AMENDMENT: THE BAND FILLS THE SHELL ────────────────────────────────
 *
 * The layout assertions here are amended rather than extended, because the
 * contract they encode changed. The lineage, kept with the tests that
 * enforce it so a tenth revision does not have to guess:
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
 *        multi-column setting. So it became two tracks reaching both
 *        gutters, each paragraph at a multi-column measure, stacking below
 *        768. The brand column left the index — it repeated the masthead —
 *        and the mark became a compact glyph in the meta row.
 *   r9 — ONE COLUMN SYSTEM. r8 left the footer with two grids: three equal
 *        tracks for the index and two for the fine print. Both were bounded
 *        by the shell and both used `--band-gap`, so they LOOKED like one
 *        system and were not. Measured at 1920, the index drew lines at
 *        64 / 677 / 1291 while the second paragraph began at 984 — a line
 *        nothing else in the footer used — so the band read as a second,
 *        misaligned object stacked under the first. There is now one
 *        `.footer-grid` template: the index puts one group per track, the
 *        fine print puts its first paragraph across the left two and its
 *        second in the right one, and the meta row spans the lot. Both
 *        paragraphs now begin on a line the index begins on.
 *
 *   r9.1 — DISTRIBUTION IS NOT TEXT ALIGNMENT. The correction, and the
 *        assertions that make it stick. Distributing three equal COLUMNS
 *        across the shell is a layout decision; aligning the text INSIDE
 *        them is a separate one, and the two had been allowed to travel
 *        together. Reaching a shell edge by centring a heading or setting
 *        a link list ragged-left buys an edge and spends the inner one:
 *        Stripe, Vercel and GitHub all distribute footer columns evenly
 *        and left-align every word inside them, and they are right. Every
 *        group heading, every link, both fine-print paragraphs and the
 *        meta row start at their own column's left edge, at every width.
 *
 *   r9.2 — SPACE-BETWEEN, AND THE TEXT STAYS PUT. r10 got distribution
 *        right by centering text (wrong); r9.1 got text right by
 *        reverting distribution (also wrong); r9.2 is space-between with
 *        left-aligned text — both at once. Equal thirds put the TRACKS on
 *        both gutters and left the INK 448px short of the right one at
 *        1920 (311px at 1440, 267px at 1280), because equal tracks
 *        distribute space and do not put marks at the ends of it. So the
 *        boxes move and the text does not: three shrink-to-fit groups
 *        under `justify-content: space-between`, first item's ink on the
 *        shell's left edge, last item's ink on its right edge, each still
 *        `text-align: start` inside. The fine print rides the same
 *        mechanism, so the two bands share their outer edges as well as
 *        their template. The meta row is the one deliberate exception —
 *        centred, because a closing signature is a single short line on
 *        the axis of the thing it closes, not a column of links.
 *
 * What changed in r9 is which LINES the band is drawn on, and in r9.2
 * whether there are lines at all rather than edges — never the measure or
 * the size. Text stays left-aligned in every cell throughout: distributing
 * the BOXES is what makes the middle group read as centred, and centring
 * the text inside them is what makes a link list look broken.
 *
 * That sentence was true and unasserted, which is the whole reason r9.1
 * exists. Nothing in this file measured `text-align`, so the alignment
 * could be — and was — changed without a single test noticing. It is
 * measured now, on the groups, the paragraphs and the meta row, above and
 * below the stacking breakpoint.
 *
 * What has not changed, and is still asserted below: the disclaimer is in
 * the footer and not the hero, every link resolves, the source and licence
 * are offered, and the build string never invents a commit it does not
 * have.
 */

test.describe("the landing footer", () => {
  // The INK is measured, not the boxes — the one instrument this file's
  // layout assertions are built on, and the reason they can tell r9's
  // problem from r10's. A group can sit in the right third of the shell
  // while everything painted inside it is centred or ragged-left, and a
  // group's box can end on the shell's right edge while its last character
  // is 448px short of it. `getBoundingClientRect` reports neither. This
  // walks the text nodes and unions the drawn rectangles.
  //
  // It is a string, and the tests `eval` it, because `page.evaluate` runs
  // in the browser and cannot close over anything in this file. The source
  // is this literal and nothing else — no input reaches it.
  const INK = `((root) => {
    const range = document.createRange();
    let left = Infinity, right = -Infinity;
    const walk = (node) => {
      if (node.nodeType === 3 && node.textContent.trim()) {
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width === 0) continue;
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
        }
      }
      for (const c of node.childNodes) walk(c);
    };
    walk(root);
    return { left, right };
  })`;

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

  // AMENDED in r8, and again in r9.2 — see the lineage at the top of this
  // file. r8's claim was that the three TRACKS reach both gutters, which
  // they did while the ink stopped 448px short of the right one at 1920.
  // The claim is now made on the ink, which is the thing anybody actually
  // sees.
  for (const width of [1280, 1440, 1920]) {
    test(`the index spreads three groups from edge to edge at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const footer = page.locator("[data-content-region] footer");

      for (const group of ["Product", "Project", "Reference"]) {
        await expect(
          footer.getByRole("navigation", { name: group }),
          `the ${group} group`,
        ).toBeVisible();
      }

      const m = await page.evaluate((inkSrc) => {
        const ink = eval(inkSrc) as (root: Element) => { left: number; right: number };
        const foot = document.querySelector("[data-content-region] footer")!;
        const band = foot.firstElementChild!;
        const box = band.getBoundingClientRect();
        return {
          band: { left: box.x, right: box.right },
          rows: new Set(
            Array.from(band.children).map((c) => Math.round(c.getBoundingClientRect().y)),
          ).size,
          groups: Array.from(band.children).map((c) => ({
            name: c.querySelector("p")!.textContent!.trim(),
            ...ink(c),
          })),
        };
      }, INK);

      expect(m.groups.length, "three groups, no brand column").toBe(3);
      expect(m.rows, `on one row at ${width}`).toBe(1);

      const [product, project, reference] = m.groups;
      expect(
        Math.abs(product!.left - m.band.left),
        `Product's ink opens at ${Math.round(product!.left)}, the band at ${Math.round(m.band.left)}`,
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(reference!.right - m.band.right),
        `Reference's ink closes at ${Math.round(reference!.right)}, the band at ${Math.round(m.band.right)}`,
      ).toBeLessThanOrEqual(2);

      // Between them, and not touching. "Distributed" and "collided" both
      // reach the two edges; only one of them is a footer.
      expect(project!.left, "Project opens after Product closes").toBeGreaterThan(product!.right);
      expect(project!.right, "Project closes before Reference opens").toBeLessThan(reference!.left);

      // And spread by `space-between` specifically, which is what makes the
      // middle group READ as centred without any text being centred: the
      // two gaps are one number. r10 reached the same two edges by setting
      // the outer groups' text to `end` and `center`, and that is the thing
      // this file exists to keep out.
      const gaps = [project!.left - product!.right, reference!.left - project!.right];
      expect(
        Math.abs(gaps[0]! - gaps[1]!),
        `both gaps get the same share: ${Math.round(gaps[0]!)} vs ${Math.round(gaps[1]!)}`,
      ).toBeLessThanOrEqual(1);
      expect(gaps[0], "and they are real gaps, not rounding").toBeGreaterThan(48);
    });
  }

  test("the brand column is gone from the index, and its tagline with it", async ({ page }) => {
    // The r8 complaint, asserted directly. A mark, a wordmark and a tagline
    // in the index's first cell was a third repetition of an identity the
    // masthead is already holding two screens above — and the tagline
    // paraphrased the hero's own subhead one screen above that.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/");
    const footer = page.locator("[data-content-region] footer");
    await expect(footer.getByText("The real-time insider-trading tape")).toHaveCount(0);
    // …and it is not orphaned as a standalone line anywhere else.
    //
    // `exact`, and this is the point rather than a detail: the hero's
    // subhead OPENS with "The real-time insider-trading tape." verbatim and
    // then keeps going. The footer's tagline was not a paraphrase of it, it
    // was its first sentence, repeated one screen below — which is the
    // clearest possible argument for the column being gone. A substring
    // match here would find the hero and read as a failure.
    await expect(page.getByText("The real-time insider-trading tape", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.locator("[data-content-region] section").first(),
      "the hero still says it, once, as its own sentence",
    ).toContainText("The real-time insider-trading tape");

    // The mark survives, at icon scale, in the meta row beside the version.
    const mark = page.getByTestId("footer-mark");
    await expect(mark).toBeVisible();
    await expect(mark).toContainText("InsiderFlow");
    const geometry = await page.evaluate(() => {
      const m = document.querySelector("[data-testid='footer-mark']")!;
      const glyph = m.querySelector("span")!;
      const version = document.querySelector("[data-testid='build-string']")!;
      const grid = document.querySelector("[data-content-region] footer")!.firstElementChild!;
      const mb = m.getBoundingClientRect();
      const vb = version.getBoundingClientRect();
      return {
        glyph: glyph.getBoundingClientRect().width,
        markLeft: mb.x,
        markRight: mb.right,
        versionLeft: vb.x,
        gridLeft: grid.getBoundingClientRect().x,
        // A footer mark is a signature, not a second way home.
        isLink: Boolean(m.closest("a")) || Boolean(m.querySelector("a")),
        isBrand: m.hasAttribute("data-brand") || Boolean(m.querySelector("[data-brand]")),
      };
    });
    expect(geometry.glyph, "icon scale, not the masthead's 20px box").toBeLessThanOrEqual(16);
    expect(geometry.markLeft, "the mark leads the meta row").toBeCloseTo(geometry.gridLeft, 0);
    expect(geometry.versionLeft, "the version sits beside it").toBeGreaterThan(geometry.markRight);
    expect(geometry.isLink, "not a second link home").toBe(false);
    expect(geometry.isBrand, "not a second navigational brand").toBe(false);
  });

  // ── r9.1: distribution is not text alignment ───────────────────────
  for (const width of [1280, 1440, 1920]) {
    test(`every footer column is left-aligned inside itself at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const m = await page.evaluate((inkSrc) => {
        const ink = eval(inkSrc) as (root: Element) => { left: number; right: number };
        const footer = document.querySelector("[data-content-region] footer")!;
        const shell = footer.getBoundingClientRect();
        const grid = footer.firstElementChild!;

        const groups = Array.from(grid.children).map((col) => {
          const box = col.getBoundingClientRect();
          const heading = col.querySelector("p")!;
          return {
            name: heading.textContent!.trim(),
            align: getComputedStyle(col).textAlign,
            trackLeft: box.x,
            trackRight: box.right,
            headingInk: ink(heading).left,
            linkInk: Array.from(col.querySelectorAll("a")).map((a) => ink(a).left),
          };
        });

        const paras = Array.from(
          document.querySelectorAll("[data-testid='footer-disclaimer'] p"),
        ).map((p) => ({
          lead: (p.textContent ?? "").trim().slice(0, 13),
          align: getComputedStyle(p).textAlign,
          blockLeft: p.getBoundingClientRect().x,
          blockRight: p.getBoundingClientRect().right,
          ink: ink(p).left,
        }));

        const metaRow = document.querySelector("[data-testid='build-string']")!.parentElement!;
        const mark = document.querySelector("[data-testid='footer-mark']")!;
        return {
          shell: { left: shell.x, right: shell.right },
          groups,
          paras,
          meta: {
            align: getComputedStyle(metaRow).textAlign,
            justify: getComputedStyle(metaRow).justifyContent,
            rowLeft: metaRow.getBoundingClientRect().x,
            rowRight: metaRow.getBoundingClientRect().right,
            markLeft: mark.getBoundingClientRect().x,
          },
        };
      }, INK);

      // 1. Every group: left-aligned, and its heading AND every one of its
      //    links flush to its own track's left edge.
      for (const g of m.groups) {
        expect(g.align, `${g.name} is left-aligned`).toMatch(/^(start|left)$/);
        expect(
          Math.abs(g.headingInk - g.trackLeft),
          `${g.name} heading ink at ${Math.round(g.headingInk)}, track at ${Math.round(g.trackLeft)}`,
        ).toBeLessThanOrEqual(1);
        for (const [i, x] of g.linkInk.entries()) {
          expect(
            Math.abs(x - g.trackLeft),
            `${g.name} link ${i + 1} ink at ${Math.round(x)}, track at ${Math.round(g.trackLeft)}`,
          ).toBeLessThanOrEqual(1);
        }
      }

      // …and the distribution is untouched: first group's box on the
      // shell's left edge, last group's box on its right edge. Under
      // `space-between` these boxes ARE the ink — the groups are
      // shrink-to-fit — which is why the two claims can be made together
      // here without one of them being vacuous.
      expect(
        Math.abs(m.groups[0]!.trackLeft - m.shell.left),
        "Product starts at the shell's left edge",
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(m.groups[m.groups.length - 1]!.trackRight - m.shell.right),
        "Reference ends at the shell's right edge",
      ).toBeLessThanOrEqual(1);

      // 2. Both fine-print paragraphs: left-aligned, ink on the block's own
      //    left edge. Right-ragged body copy is a defect, not a style.
      for (const p of m.paras) {
        expect(p.align, `"${p.lead}" is left-aligned`).toMatch(/^(start|left)$/);
        expect(
          Math.abs(p.ink - p.blockLeft),
          `"${p.lead}" ink at ${Math.round(p.ink)}, block at ${Math.round(p.blockLeft)}`,
        ).toBeLessThanOrEqual(1);
      }
      expect(
        Math.abs(m.paras[0]!.blockLeft - m.shell.left),
        "the disclaimer keys to the shell's left edge",
      ).toBeLessThanOrEqual(1);
      // AMENDED in r9.2. r9 keyed this to the third track's LEFT edge,
      // which was a line the index also began on — until the index stopped
      // having tracks. It keys to the edge instead: the block closes where
      // Reference closes, and the text runs left from there, asserted
      // above along with every other paragraph in this footer.
      expect(
        Math.abs(m.paras[1]!.blockRight - m.shell.right),
        `the sources note closes at ${Math.round(m.paras[1]!.blockRight)}, shell at ${Math.round(m.shell.right)}`,
      ).toBeLessThanOrEqual(1);

      // 3. The meta row: left-aligned, spanning the shell, with the mark on
      //    the same left edge as Product and the disclaimer above it.
      expect(m.meta.align, "the meta row is left-aligned").toMatch(/^(start|left)$/);
      expect(m.meta.justify, "and its flex run is not centred").toMatch(
        /^(normal|flex-start|start)$/,
      );
      expect(
        Math.abs(m.meta.markLeft - m.shell.left),
        `the mark starts at ${Math.round(m.meta.markLeft)}, shell at ${Math.round(m.shell.left)}`,
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(m.meta.rowLeft - m.shell.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.meta.rowRight - m.shell.right)).toBeLessThanOrEqual(1);

      // One left edge for all three bands, stated as the single equality
      // this correction is about.
      expect(
        new Set(
          [m.groups[0]!.headingInk, m.paras[0]!.ink, m.meta.markLeft, m.shell.left].map(Math.round),
        ).size,
        "Product, the disclaimer, the mark and the shell share one left edge",
      ).toBe(1);
    });
  }

  test("the stacked footer stays left-aligned below 768", async ({ page }) => {
    for (const width of [390, 767]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const aligns = await page.evaluate(() => {
        const footer = document.querySelector("[data-content-region] footer")!;
        return {
          groups: Array.from(footer.firstElementChild!.children).map(
            (c) => getComputedStyle(c).textAlign,
          ),
          paras: Array.from(document.querySelectorAll("[data-testid='footer-disclaimer'] p")).map(
            (p) => getComputedStyle(p).textAlign,
          ),
          meta: getComputedStyle(
            document.querySelector("[data-testid='build-string']")!.parentElement!,
          ).textAlign,
        };
      });
      for (const a of [...aligns.groups, ...aligns.paras, aligns.meta]) {
        expect(a, `everything is start-aligned at ${width}`).toMatch(/^(start|left)$/);
      }
    }
  });

  test("the index collapses 3 to 2 to 1", async ({ page }) => {
    await page.goto("/");
    const rowsAt = async (width: number) => {
      await page.setViewportSize({ width, height: 1000 });
      return page.evaluate(() => {
        const grid = document.querySelector("[data-content-region] footer")!.firstElementChild!;
        const tops = Array.from(grid.children).map((c) => Math.round(c.getBoundingClientRect().y));
        return new Set(tops).size;
      });
    };
    expect(await rowsAt(1440), "three across on a desktop").toBe(1);
    expect(await rowsAt(700), "two up on a tablet").toBe(2);
    expect(await rowsAt(390), "one column on a phone").toBe(3);
  });

  // AMENDED in r8, r9 and again in r9.2 — see the lineage at the top of
  // this file. The claim each time is the same one: the fine print and the
  // index are ONE object, not two stacked ones. What changes is what that
  // means. r8: both bounded by the shell. r9: both on one grid template,
  // so both paragraphs opened on a line the index opened on. r9.2: both on
  // one `space-between` row, so both bands open and close on the same two
  // edges — which is the only version of the claim that survives the index
  // having edges instead of tracks.
  for (const width of [1280, 1440, 1920]) {
    test(`the fine print rides the index's own edges at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const measured = await page.evaluate(() => {
        const el = document.querySelector("[data-testid='footer-disclaimer']")!;
        const band = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const paras = Array.from(el.querySelectorAll("p")).map((p) => {
          const r = p.getBoundingClientRect();
          const cs = getComputedStyle(p);
          return {
            x: r.x,
            right: r.right,
            width: r.width,
            fontSize: parseFloat(cs.fontSize),
            align: cs.textAlign,
          };
        });
        return {
          band: { x: band.x, right: band.right, width: band.width },
          gap: parseFloat(s.columnGap),
          rule: parseFloat(s.borderTopWidth),
          ruleColour: s.borderTopColor,
          paras,
        };
      });

      // AMENDED in r9.2: the band has no template of its own, and neither
      // does the index — they have a mechanism, and it is the same one.
      // Compared on the resolved values, which is the only way to catch two
      // layouts that agree today and drift tomorrow. r8 had three tracks
      // above and two below, both bounded by the shell and both using
      // `--band-gap`, which is precisely how they looked like one system
      // while not being one.
      const mechanism = await page.evaluate(() => {
        const read = (el: Element) => {
          const s = getComputedStyle(el);
          return {
            display: s.display,
            justify: s.justifyContent,
            gap: s.columnGap,
            template: s.gridTemplateColumns,
          };
        };
        return {
          index: read(document.querySelector("[data-content-region] footer")!.firstElementChild!),
          band: read(document.querySelector("[data-testid='footer-disclaimer']")!),
        };
      });
      expect(mechanism.band.display, "one display mode for both bands").toBe(
        mechanism.index.display,
      );
      expect(mechanism.band.display, "and it is the flex row, above 768").toBe("flex");
      expect(mechanism.band.justify, "one distribution for both bands").toBe(
        mechanism.index.justify,
      );
      expect(mechanism.band.justify, "and it is space-between").toBe("space-between");
      expect(mechanism.band.gap, "one gap token for both bands").toBe(mechanism.index.gap);
      // Both still carry the stacking template they fall back to below
      // 768 — inert here, since a flex box does not lay out on it — and it
      // is the SAME one. r8's two bands drifted apart by having two
      // templates that happened to agree; this is the assertion that says
      // they are one declaration.
      expect(mechanism.band.template, "one stacking fallback for both bands").toBe(
        mechanism.index.template,
      );

      expect(measured.paras.length).toBe(2);
      expect(measured.paras[0]!.x, "the first paragraph opens on the band's edge").toBeCloseTo(
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

      // THE r9.2 CLAIM, which replaces r9's. r9 asserted that both
      // paragraphs began on a line the INDEX also began on — the fix for
      // r8, which had put the second at the band's own midpoint, 984 at
      // 1920 against index lines at 64 / 677 / 1291. Under `space-between`
      // the index has no interior lines to share, so the two bands share
      // what they now both have: the outer edges. The first paragraph opens
      // where the first group opens; the last closes where the last group
      // closes.
      const edges = await page.evaluate((inkSrc) => {
        const ink = eval(inkSrc) as (root: Element) => { left: number; right: number };
        const groups = Array.from(
          document.querySelector("[data-content-region] footer")!.firstElementChild!.children,
        );
        return {
          open: ink(groups[0]!).left,
          close: ink(groups[groups.length - 1]!).right,
        };
      }, INK);
      expect(
        Math.abs(measured.paras[0]!.x - edges.open),
        `the disclaimer opens at ${Math.round(measured.paras[0]!.x)}, Product at ${Math.round(edges.open)}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(measured.paras[1]!.right - edges.close),
        `the sources note closes at ${Math.round(measured.paras[1]!.right)}, Reference at ${Math.round(edges.close)}`,
      ).toBeLessThanOrEqual(1);

      // Left-aligned, every one of them. Distributing the BOXES is the
      // whole mechanism; centring or right-aligning the text inside them
      // is what would make this read as broken. The second block closes on
      // the right edge and its text still runs left from its own left
      // edge — a right-ragged paragraph is a defect, not a style.
      for (const p of measured.paras) {
        expect(p.align, "fine print is left-aligned").toMatch(/^(start|left)$/);
      }

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

  // AMENDED and expanded in r9: the three bands are asserted as ONE system
  // at three widths, rather than the meta row being checked on its own.
  for (const width of [1280, 1440, 1920]) {
    test(`the three bands share the shell's edges and one rhythm at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      const bands = await page.evaluate(() => {
        const footer = document.querySelector("[data-content-region] footer")!;
        const f = footer.getBoundingClientRect();
        const read = (el: Element, name: string) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            name,
            left: r.x,
            right: r.right,
            marginTop: parseFloat(s.marginTop),
            paddingTop: parseFloat(s.paddingTop),
            rule: s.borderTopStyle === "none" ? 0 : parseFloat(s.borderTopWidth),
            ruleColour: s.borderTopColor,
          };
        };
        return {
          shell: { left: f.x, right: f.right },
          list: [
            read(footer.firstElementChild!, "index"),
            read(document.querySelector("[data-testid='footer-disclaimer']")!, "fine print"),
            read(document.querySelector("[data-testid='build-string']")!.parentElement!, "meta"),
          ],
        };
      });

      // Every band, gutter to gutter. A band that stops short reads as a
      // caption under one column rather than as part of the footer.
      for (const band of bands.list) {
        expect(
          Math.abs(band.left - bands.shell.left),
          `${band.name} starts at ${Math.round(band.left)}, shell at ${Math.round(bands.shell.left)}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(band.right - bands.shell.right),
          `${band.name} ends at ${Math.round(band.right)}, shell at ${Math.round(bands.shell.right)}`,
        ).toBeLessThanOrEqual(1);
      }

      // The two internal dividers carry the SAME rhythm. r8 gave the first
      // 40px above and 24 below and the second 24 above and 16 below, so a
      // footer whose bands were meant to read as one system had two
      // different vertical spacings between them.
      const finePrint = bands.list[1]!;
      const meta = bands.list[2]!;
      expect(finePrint.rule, "the fine print is ruled off").toBeGreaterThan(0);
      expect(meta.rule, "the meta row is ruled off").toBeGreaterThan(0);
      expect(finePrint.ruleColour).not.toBe("rgba(0, 0, 0, 0)");
      expect(meta.ruleColour, "both rules are drawn from one token").toBe(finePrint.ruleColour);
      expect(meta.marginTop, "same space above both rules").toBe(finePrint.marginTop);
      expect(meta.paddingTop, "same space below both rules").toBe(finePrint.paddingTop);
    });
  }

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

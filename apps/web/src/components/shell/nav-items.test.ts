import { describe, expect, it } from "vitest";

import { activeNavHref, NAV } from "./nav-items";

/**
 * `aria-current="page"` is an assertion, and a screen reader repeats it.
 * Two current pages is a lie told twice; zero on a page that plainly lives
 * under a section is a nav that has stopped orienting anyone. Both were
 * possible before this matcher existed, so both are pinned here.
 */
describe("activeNavHref", () => {
  it("matches a section's own route", () => {
    expect(activeNavHref("/trades")).toBe("/trades");
    expect(activeNavHref("/screener")).toBe("/screener");
    expect(activeNavHref("/design")).toBe("/design");
  });

  it("keeps a detail page inside its section", () => {
    expect(activeNavHref("/politicians/abc-123")).toBe("/politicians");
    expect(activeNavHref("/companies/anything")).toBe("/companies");
  });

  it("prefers the most specific entry when routes nest", () => {
    // Both /docs and /docs/methodology are nav entries. Naive prefix
    // matching lights both; the longest match is the one a reader means.
    expect(activeNavHref("/docs/methodology")).toBe("/docs/methodology");
    expect(activeNavHref("/docs")).toBe("/docs");
  });

  it("never matches on a partial segment", () => {
    // "/tradesman" is not inside "/trades", however it sorts as a string.
    expect(activeNavHref("/tradesman")).toBeNull();
    expect(activeNavHref("/designer")).toBeNull();
  });

  it("treats the root as exact, so every route is not 'Overview'", () => {
    expect(activeNavHref("/")).toBe("/");
    expect(activeNavHref("/heatmap")).toBe("/heatmap");
  });

  it("returns null where no section owns the route", () => {
    // A stock page belongs to no section. Marking the nearest one would be
    // a guess presented as a fact.
    expect(activeNavHref("/stock/ZZNOVA")).toBeNull();
    expect(activeNavHref("/settings")).toBeNull();
    expect(activeNavHref("/login")).toBeNull();
  });

  it("resolves to at most one entry for every nav destination", () => {
    const hrefs = NAV.flatMap((s) => s.items.filter((i) => !i.soon).map((i) => i.href));
    for (const href of hrefs) {
      const matches = hrefs.filter((candidate) => candidate === activeNavHref(href));
      expect(matches, `${href} should resolve to exactly one nav entry`).toHaveLength(1);
    }
  });
});

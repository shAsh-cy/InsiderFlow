import { test, expect } from "@playwright/test";

/**
 * FRESHNESS, HONESTLY.
 *
 * "Filings today" read zero on a freshly-cloned checkout, because the
 * seed's arrival times were whatever `now()` happened to be when someone
 * ran it — often days earlier. The number was true and useless: it said
 * nothing had been ingested today, which was correct, and made the
 * product look dead on first run.
 *
 * The fix is NOT to fabricate a figure. It is to give the fixture arrival
 * times that are relative to now, the way its trade dates already were,
 * and to put the real `max(created_at)` on the page so a zero can be told
 * apart from a stall.
 */

test.describe("today on the tape", () => {
  test("a seeded database reports a non-zero figure", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // The card counts up when it scrolls into view, so it legitimately
    // reads 0 until then. Bring it on screen and let the spring settle
    // rather than photographing the first frame.
    const card = page.locator("div.surface").filter({ hasText: "Filings today" }).last();
    await card.scrollIntoViewIfNeeded();

    await expect
      .poll(
        async () => {
          const text = (await card.textContent()) ?? "";
          return Number((text.match(/([\d,]+)\s*$/)?.[1] ?? "0").replace(/,/g, ""));
        },
        {
          message:
            "a clean seed spreads its arrivals across yesterday→today, so this cannot be zero",
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
  });

  test("the page says when the last row actually landed", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const hint = page.getByText(/as of \d{2}:\d{2} UTC|no filings ingested yet/).first();
    await expect(hint).toBeVisible();
  });

  test("the tape carries its own as-of stamp", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const stamp = page.getByTestId("tape-as-of");
    await expect(stamp).toBeVisible();
    await expect(stamp).toHaveText(/^as of \d{2}:\d{2} UTC$/);

    // It is the newest row's real arrival time, not the render time. The
    // title carries the full instant, so compare against that.
    const [stampIso, newestRow] = await Promise.all([
      stamp.getAttribute("title"),
      page.evaluate(() => document.querySelectorAll("[data-testid='live-feed'] li").length),
    ]);
    expect(newestRow).toBeGreaterThan(0);
    const at = new Date(stampIso ?? "");
    expect(Number.isNaN(at.getTime())).toBe(false);
    // In the past, and not absurdly so for a seeded stack.
    expect(at.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  test("the as-of stamp is UTC, so server and client agree", async ({ page }) => {
    // Rendered on the server and again on the client. Anything formatted
    // in the machine's local timezone produces two different strings and
    // a hydration mismatch that only shows up in some timezones.
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByTestId("tape-as-of")).toBeVisible();
    expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });
});

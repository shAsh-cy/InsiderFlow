import { expect, test } from "@playwright/test";

/**
 * CSV and XLSX export.
 *
 * The audit marked these NOT TESTED: the work happens entirely in the browser
 * (fetch → build a Blob → click a synthetic anchor), so nothing server-side
 * could observe it and the unit tests only covered the string formatting. A
 * download that never fires, or fires with a header row and no data, would
 * have looked identical to a working one from outside.
 *
 * These drive the real button and read the real file off disk.
 *
 * Run against the compose stack:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/export.spec.ts
 */

test.describe("screener export", () => {
  test("CSV downloads with a header row and one line per trade", async ({ page }) => {
    await page.goto("/screener");
    await expect(page.getByTestId("result-count")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "CSV" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");

    const lines = text.trim().split(/\r?\n/);
    expect(lines.length, "header plus at least one data row").toBeGreaterThan(1);

    // The header is the export contract: renaming a column silently breaks
    // every spreadsheet someone built on it.
    const header = lines[0]!.split(",");
    for (const column of [
      "date",
      "market",
      "ticker",
      "company",
      "insider",
      "code",
      "direction",
      "relevance",
      "shares",
      "price",
      "value",
      "currency",
      "value_usd",
      "accession_no",
    ]) {
      expect(header, `missing column: ${column}`).toContain(column);
    }

    // Same honesty rule as every other surface: a not-disclosed price is an
    // empty cell, never a 0 that a spreadsheet will happily average.
    const priceIndex = header.indexOf("price");
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      expect(cells[priceIndex], `a zero price in ${line}`).not.toBe("0");
    }
  });

  test("XLSX downloads as a real workbook", async ({ page }) => {
    await page.goto("/screener");
    await expect(page.getByTestId("result-count")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "XLSX" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);

    // XLSX is a zip, so it opens with the local-file-header magic bytes
    // 0x50 0x4B 0x03 0x04. Cheap, and enough to catch the failure that
    // matters — the lazy-loaded sheet library not arriving, leaving an empty
    // or HTML-error file with the right extension.
    expect(buffer.length).toBeGreaterThan(100);
    expect([...buffer.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

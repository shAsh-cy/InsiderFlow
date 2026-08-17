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

    // ── r12: read the workbook, not just its first four bytes ─────────
    //
    // The magic bytes passed before and after the writer changed from
    // SheetJS to `write-excel-file`, which means they would also have
    // passed a migration that produced a valid, EMPTY, or wrongly-typed
    // workbook. The CSV half of this file asserts the header contract and
    // the not-disclosed rule; the XLSX half asserted neither, and a
    // spreadsheet is exactly where a 0 standing in for "not disclosed"
    // does the most damage — AVERAGE() does not ask.
    //
    // Unzipped here rather than parsed with a spreadsheet library on
    // purpose: the point of the migration is that no XLSX PARSER exists
    // in this project any more, and a test that reintroduced one to check
    // the writer would be undoing it. `fflate` is a devDependency and the
    // input is a file this test just produced.
    const { unzipSync, strFromU8 } = await import("fflate");
    const entries = unzipSync(new Uint8Array(buffer));
    const sheetXml = strFromU8(entries["xl/worksheets/sheet1.xml"]!);
    const strings = [
      ...strFromU8(entries["xl/sharedStrings.xml"] ?? new Uint8Array()).matchAll(
        /<t[^>]*>([\s\S]*?)<\/t>/g,
      ),
    ].map((m) => m[1]!);

    // Row 1 is the header, and it is the same contract the CSV exports.
    // Cells reference the shared-string table by index, so the header row
    // resolves through it.
    const headerRow = /<row r="1"[^>]*>([\s\S]*?)<\/row>/.exec(sheetXml)?.[1] ?? "";
    const headerCells = [...headerRow.matchAll(/<v>(\d+)<\/v>/g)].map((m) => strings[Number(m[1])]);
    for (const column of ["date", "ticker", "insider", "price", "value_usd", "accession_no"]) {
      expect(headerCells, `missing column: ${column}`).toContain(column);
    }

    // At least one data row, so an empty workbook cannot pass.
    const rows = [...sheetXml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...rows), "header plus at least one trade").toBeGreaterThan(1);

    // A not-disclosed price is an ABSENT cell. In SpreadsheetML an empty
    // cell is omitted from its row entirely, so the failure this catches
    // is a `0` appearing in the price column — asserted by column letter,
    // since that is what a spreadsheet actually reads.
    const priceColumn = String.fromCharCode(65 + headerCells.indexOf("price"));
    for (const row of rows.filter((r) => r > 1)) {
      const cell = new RegExp(`<c r="${priceColumn}${row}"[^>]*>(?:(?!</c>)[\\s\\S])*?</c>`).exec(
        sheetXml,
      )?.[0];
      if (!cell) continue; // absent — a not-disclosed price, which is correct
      expect(cell, `a zero price in row ${row}`).not.toMatch(/<v>0<\/v>/);
    }
  });
});

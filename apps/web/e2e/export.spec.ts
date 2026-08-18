import { expect, test } from "@playwright/test";
import type { Page, Response as PlaywrightResponse } from "@playwright/test";

import type { TradeRow } from "../src/lib/api/queries";

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

type Cell = string | number | boolean | null;

/**
 * The export's column contract, restated here rather than imported.
 *
 * `tradesToExportRows` is the SUBJECT. A test that read its column list off
 * the function itself would agree with whatever that function currently
 * does, including a rename nobody meant and a column silently reading the
 * wrong field — which is the shape of bug that survives a well-formedness
 * check untouched. Written out a second time, changing a column is a
 * two-file edit and the second file is the one somebody has to justify.
 */
const EXPORT_COLUMNS: ReadonlyArray<readonly [string, (t: TradeRow) => Cell]> = [
  ["date", (t) => t.txnDate],
  ["market", (t) => t.market],
  ["ticker", (t) => t.company.ticker],
  ["company", (t) => t.company.name],
  ["insider", (t) => t.insider.name],
  ["title", (t) => t.insider.title],
  ["code", (t) => t.code],
  ["direction", (t) => t.direction],
  ["relevance", (t) => t.relevance],
  ["source", (t) => t.source],
  ["shares", (t) => t.shares],
  ["price", (t) => t.price],
  ["value", (t) => t.value],
  ["currency", (t) => t.currency],
  ["price_usd", (t) => t.priceUsd],
  ["value_usd", (t) => t.valueUsd],
  ["rule_10b5_1", (t) => t.is10b51],
  ["derivative", (t) => t.isDerivative],
  ["accession_no", (t) => t.filing?.accessionNo ?? null],
];

const COLUMN_NAMES = EXPORT_COLUMNS.map(([name]) => name);

/**
 * The columns where a fabricated 0 stops being a formatting choice.
 *
 * A missing ticker exports as an empty cell and reads as missing. A missing
 * PRICE that exports as 0 reads as a share handed over for nothing, and
 * AVERAGE() down the column does not ask. Every null must be empty; these
 * are the ones the suite refuses to run without having seen at least once.
 */
const NOT_DISCLOSED_MATTERS = new Set(["shares", "price", "value", "price_usd", "value_usd"]);

/**
 * What the reader sees on the screener, and the export column carrying it.
 *
 * "vs close" is derived from a cached price series rather than read off the
 * filing, so it has no source field and no export column. Every other
 * header on screen must land in the file — the failure this pins down is a
 * column added to the table and forgotten in the export, which leaves the
 * download quietly narrower than the screen it claims to be.
 */
const SCREEN_TO_EXPORT: Record<string, string | null> = {
  Date: "date",
  Company: "ticker",
  Code: "code",
  Insider: "insider",
  Role: "title",
  Shares: "shares",
  Price: "price",
  Value: "value",
  "vs close": null,
  Type: "relevance",
  Source: "source",
};

/**
 * How many rendered rows the file is pinned to cell by cell.
 *
 * The table is virtualized, so only the visible window is in the DOM and
 * this is a sample rather than the whole screen. Beyond it the file is held
 * to the API capture and the exact row count.
 */
const ANCHOR_ROWS = 5;

/** `collectForExport` drains the listing 50 rows at a time... */
const EXPORT_PAGE_SIZE = 50;
/** ...and stops at ten pages, so one click cannot hammer the API. */
const EXPORT_MAX_PAGES = 10;

/**
 * The screen the two comparisons below run against: everything filed up to
 * yesterday.
 *
 * The unfiltered screener is not a stable subject for a cell-by-cell
 * comparison. Every transient fixture in this suite is dated CURRENT_DATE,
 * so one landing between the page's render and the export's fetch makes the
 * table and the file disagree about what "this screen" was — seen once, as
 * a one-row difference, and it would have read as an export bug every time
 * it recurred. A date bound removes the whole class at the source rather
 * than retrying past it, and costs the test nothing: the seeded tape is
 * months of filings across five companies, two currencies and an
 * undisclosed price.
 */
const STABLE_SCREEN = `/screener?to=${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}`;

/**
 * A seeded ticker, and a screen where the filter actually removes rows.
 *
 * The date bound above is doing no filtering work: the seeded tape ends
 * months before today, so `to=<yesterday>` matches every row in it. That
 * makes the two comparisons above blind to the defect that matters most on
 * an export button — a file that ignores the reader's filters and hands
 * back the whole tape. Measured, not assumed: rewriting `collectForExport`
 * to fetch `{limit, offset}` with the screen's params dropped leaves every
 * other assertion in this file green, because on this screen the filtered
 * and unfiltered listings are the same 25 rows.
 *
 * ZZNOVA rather than a market or a code: it is seeded, and the transient
 * fixtures in e2e/fixtures.ts mint a RANDOM five-character ZZ ticker per
 * run, so no other agent's row can wander into this screen and change what
 * the filter is worth.
 */
const FILTERED_TICKER = "ZZNOVA";
const FILTERED_SCREEN = `${STABLE_SCREEN}&ticker=${FILTERED_TICKER}`;

/**
 * The screen's own claim about how many rows it is showing.
 *
 * A "+" means the count is a floor — the listing outran its first page —
 * and every comparison here treats it as exact, so the shape is asserted
 * rather than parsed past.
 */
async function readExactCount(page: Page, label: string): Promise<number> {
  const text = (await page.getByTestId("result-count").innerText()).trim();
  expect(text, `${label}: the count is a floor, not a total, so it cannot be compared`).toMatch(
    /^\d+ rows$/,
  );
  return Number(text.replace(" rows", ""));
}

interface ExportedFile {
  filename: string;
  bytes: Buffer;
  /** The rows the export itself fetched, concatenated in page order. */
  source: TradeRow[];
}

/**
 * Click an export button and keep BOTH halves of the comparison: the bytes
 * that landed on disk, and the API pages the click drained to build them.
 *
 * Re-querying the API afterwards would be a different question. The tape
 * moves — this suite's own fixtures insert rows while it runs — so a trade
 * ingested between the export and the check would arrive as an export bug
 * and send somebody after a writer that was working. These are the exact
 * rows the file was built from, so a mismatch belongs to the writer and to
 * nothing else.
 */
async function exportAndCapture(page: Page, button: "CSV" | "XLSX"): Promise<ExportedFile> {
  const pages: Array<{ offset: number; hasMore: boolean; rows: TradeRow[] }> = [];
  const bodies: Array<Promise<void>> = [];

  const capture = (response: PlaywrightResponse) => {
    const { pathname } = new URL(response.url());
    if (pathname !== "/api/trades" && !pathname.startsWith("/api/screener/")) return;
    bodies.push(
      response
        .json()
        .then((body: { data: TradeRow[]; meta: { offset: number; hasMore: boolean } }) => {
          pages.push({ offset: body.meta.offset, hasMore: body.meta.hasMore, rows: body.data });
        }),
    );
  };

  page.on("response", capture);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button }).click(),
  ]);
  page.off("response", capture);
  await Promise.all(bodies);
  pages.sort((a, b) => a.offset - b.offset);

  // A response this listener missed would SHORTEN the expectation, and a
  // comparison against a short expectation passes. So the drain accounts
  // for itself: contiguous pages from zero, ending either where the API
  // says the listing ends or at the export's own page cap.
  expect(pages.length, "the export fetched no rows at all").toBeGreaterThan(0);
  expect(
    pages.map((p) => p.offset),
    "the offsets the export drained, in order",
  ).toEqual(pages.map((_, i) => i * EXPORT_PAGE_SIZE));
  if (pages.length < EXPORT_MAX_PAGES) {
    expect(
      pages[pages.length - 1]!.hasMore,
      "the export stopped short of the end of the listing",
    ).toBe(false);
  }

  const chunks: Buffer[] = [];
  const stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));

  return {
    filename: download.suggestedFilename(),
    bytes: Buffer.concat(chunks),
    source: pages.flatMap((p) => p.rows),
  };
}

/**
 * RFC 4180, strictly: quoted fields, doubled quotes inside them, and CRLF
 * as the only row terminator.
 *
 * `split(",")` would tear "Apple, Inc." in half and quietly shift every
 * later column left, so a lenient reader here would hide the exact defect
 * the escaping exists to prevent. A bare LF is left inside the cell rather
 * than treated as a line break, so an export that lost its CRLF endings
 * fails as a mismatched row instead of parsing anyway.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const unescapeXml = (s: string): string =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** Zero-based column index to its spreadsheet reference: 0 → A, 26 → AA. */
function columnRef(index: number): string {
  let ref = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
  }
  return ref;
}

/**
 * Read a workbook back with `fflate` and two regexes.
 *
 * Deliberately not a spreadsheet library: r12 removed SheetJS so that no
 * XLSX PARSER exists in this tree at all, and a test that reintroduced one
 * in order to check the writer would be undoing the thing it was checking
 * (`src/lib/security/upload-surface.test.ts` fails the moment one appears).
 * `fflate` is a devDependency and the only archive it ever opens is one
 * this test produced a moment earlier.
 *
 * Cells are keyed by REFERENCE rather than by position because SpreadsheetML
 * omits an empty cell from its row entirely — an absent key IS the
 * not-disclosed case, and it is the distinction the whole file rests on.
 */
async function readWorkbook(bytes: Buffer): Promise<{ cells: Map<string, Cell>; lastRow: number }> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(new Uint8Array(bytes));
  const xml = strFromU8(entries["xl/worksheets/sheet1.xml"]!);
  const shared = [
    ...strFromU8(entries["xl/sharedStrings.xml"] ?? new Uint8Array()).matchAll(
      /<t[^>]*>([\s\S]*?)<\/t>/g,
    ),
  ].map((m) => unescapeXml(m[1]!));

  const cells = new Map<string, Cell>();
  let lastRow = 0;
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>\s*<v>([\s\S]*?)<\/v>\s*<\/c>/g)) {
    const raw = m[4]!;
    lastRow = Math.max(lastRow, Number(m[2]));
    // No `t` attribute is the numeric case, which is the point: a share
    // count written as text sums to zero in every spreadsheet there is.
    const type = /t="([a-z]+)"/.exec(m[3]!)?.[1] ?? "n";
    const value: Cell =
      type === "s" ? (shared[Number(raw)] ?? null) : type === "b" ? raw === "1" : Number(raw);
    cells.set(`${m[1]}${m[2]}`, value);
  }
  return { cells, lastRow };
}

/** Every (row, column) the API reported as not disclosed. */
function nullsIn(source: TradeRow[]): Array<{ row: number; col: number; name: string }> {
  return source.flatMap((trade, row) =>
    EXPORT_COLUMNS.flatMap(([name, read], col) =>
      read(trade) === null ? [{ row, col, name }] : [],
    ),
  );
}

/**
 * Refuse to report coverage the sample did not earn.
 *
 * If nothing in this screen has an undisclosed price, the not-disclosed
 * rule below is asserted over an empty list and passes with the rule
 * deleted — nine assertions in this project have failed exactly that way.
 * The seed carries a grant with no price for this reason.
 */
function assertNotDisclosedIsRepresented(nulls: Array<{ name: string }>): void {
  expect(
    nulls.filter((n) => NOT_DISCLOSED_MATTERS.has(n.name)).map((n) => n.name),
    "no undisclosed price, value or share count in this screen, so the not-disclosed rule " +
      "below asserts nothing — the seed needs a row that leaves a figure blank",
  ).not.toEqual([]);
}

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

  /* ── r15: the file against its SOURCE ROWS ─────────────────────────────
   *
   * Everything above proves a file arrives and is shaped like a file. None
   * of it proves the file says what the screen said. A writer that dropped
   * the last page, transposed two columns, or rendered every not-disclosed
   * price as the string "null" passes both tests above and is wrong in the
   * only way that costs anyone anything — somebody sorts it, sums it, and
   * acts on it.
   *
   * So these two read the bytes back cell by cell against the rows the
   * export itself fetched, and against what the reader had on screen when
   * they clicked.
   */

  test("CSV carries the screen's rows, in order, cell for cell", async ({ page }) => {
    await page.goto(STABLE_SCREEN);
    await expect(page.getByTestId("result-count")).toBeVisible();

    // Read BEFORE the click. The file-versus-API comparison below cannot
    // catch an export that queried the WRONG screen — both halves would
    // drift together and agree — so the file is pinned to the table the
    // reader was looking at as well.
    const rendered = page.getByRole("row");
    // `result-count` paints with the server's markup, but the table body is
    // virtualized and fills in once hydration has measured the viewport, so
    // for a beat the header can be the only row in the DOM. Counting then
    // samples fewer rows than intended and reports nothing about it — or
    // finds none at all, which is how this read failed 2 runs in 3. Waiting
    // for the last row it intends to sample makes the sample size a fixed
    // ANCHOR_ROWS rather than whatever had rendered by the time it looked.
    await expect(
      rendered.nth(ANCHOR_ROWS),
      `fewer than ${ANCHOR_ROWS} rows rendered to compare the export against`,
    ).toBeVisible();
    const sampled = Math.min((await rendered.count()) - 1, ANCHOR_ROWS);
    expect(sampled, "no rows rendered to compare the export against").toBeGreaterThan(0);
    const onScreenRows: Array<{ date: string; company: string }> = [];
    for (let i = 1; i <= sampled; i += 1) {
      const cells = rendered.nth(i).getByRole("cell");
      onScreenRows.push({
        date: (await cells.nth(0).innerText()).trim(),
        company: (await cells.nth(1).innerText()).trim(),
      });
    }

    const { filename, bytes, source } = await exportAndCapture(page, "CSV");
    expect(filename).toMatch(/\.csv$/);

    const parsed = parseCsv(bytes.toString("utf8"));
    const header = parsed[0]!;
    const body = parsed.slice(1);

    // The header in full and in order. Asserting each column with
    // `toContain` would pass a file whose columns had been shuffled under
    // their own names — worse than a rename, because it looks right.
    expect(header, "the export header row").toEqual(COLUMN_NAMES);

    // Read AFTER the export, for the same reason the row count below is: the
    // table's header is server-rendered and re-rendered on hydration, and a
    // read taken before the click can return the server's markup instead of
    // the client's. Measured, not assumed — a client-side rename of one
    // header was caught only 2 runs in 3 while this read sat above the
    // click, which is a coin toss deciding whether the check below runs
    // against the table the reader ends up looking at. The click itself is
    // the proof hydration finished: the handler that fired is client code.
    const onScreenColumns = (await page.getByRole("columnheader").allInnerTexts()).map((s) =>
      s.trim(),
    );
    // The mapping is a loop over what the screen reported. If the table ever
    // stops exposing column headers the loop runs zero times and the
    // added-a-column-forgot-the-export check disappears without a failure.
    expect(onScreenColumns, "no column headers on screen to map to export columns").not.toEqual([]);

    for (const label of onScreenColumns) {
      expect(
        Object.keys(SCREEN_TO_EXPORT),
        `a column on screen this test has never heard of: "${label}". If the table gained a ` +
          "column, say here which export column carries it — or that nothing does, and why",
      ).toContain(label);
      const column = SCREEN_TO_EXPORT[label];
      if (column) expect(header, `"${label}" is on screen but not in the export`).toContain(column);
    }

    const expected = source.map((trade) =>
      EXPORT_COLUMNS.map(([, read]) => {
        const value = read(trade);
        return value === null ? "" : String(value);
      }),
    );
    expect(body.length, "one CSV line per row the export fetched").toBe(expected.length);
    for (const [i, cells] of body.entries()) {
      const trade = source[i]!;
      expect(cells, `CSV line ${i + 2}: ${trade.txnDate} ${trade.company.ticker}`).toEqual(
        expected[i],
      );
    }

    // The count is the screen's own claim about itself, and this screen
    // fits inside one page, so it is exact rather than the "50+" floor the
    // unfiltered tape shows. If the seeded tape ever outgrows a page the
    // right answer is a new assertion about the drain, not a `>=` here.
    //
    // Read after the export rather than with the rest of the screen state:
    // the count is server-rendered first and re-rendered on hydration, and
    // the pre-hydration value would let a client-side miscount through.
    const countText = (await page.getByTestId("result-count").innerText()).trim();
    expect(countText, "the row count on screen").toBe(`${body.length} rows`);

    for (const [i, seen] of onScreenRows.entries()) {
      const ticker = body[i]![header.indexOf("ticker")]!;
      expect(ticker, `line ${i + 2} exported no ticker to match the table against`).not.toBe("");
      expect(body[i]![header.indexOf("date")], `line ${i + 2} against the rendered table`).toBe(
        seen.date,
      );
      // The company cell carries a country flag beside the ticker, so the
      // ticker is looked for inside it rather than matched against it.
      expect(seen.company, `line ${i + 2} against the rendered table`).toContain(ticker);
    }

    // Stated on its own although the comparison above already covers it:
    // this is the invariant the product is judged on, and it should fail
    // by name rather than as one differing cell in a row of nineteen.
    const nulls = nullsIn(source);
    assertNotDisclosedIsRepresented(nulls);
    for (const { row, col, name } of nulls) {
      expect(
        body[row]![col],
        `${name} is not disclosed on line ${row + 2}; a 0 or the word "null" here becomes a fact`,
      ).toBe("");
    }
  });

  test("XLSX carries the API's values with their types, and leaves not-disclosed empty", async ({
    page,
  }) => {
    await page.goto(STABLE_SCREEN);
    await expect(page.getByTestId("result-count")).toBeVisible();

    const { filename, bytes, source } = await exportAndCapture(page, "XLSX");
    expect(filename).toMatch(/\.xlsx$/);

    const { cells, lastRow } = await readWorkbook(bytes);

    expect(
      COLUMN_NAMES.map((_, i) => cells.get(`${columnRef(i)}1`)),
      "the workbook header row",
    ).toEqual(COLUMN_NAMES);
    expect(lastRow, "header plus one row per row the export fetched").toBe(source.length + 1);

    // Nothing may sit to the right of the header: a value in an unlabelled
    // column is data the reader cannot identify.
    const headerRefs = COLUMN_NAMES.map((_, i) => columnRef(i));
    const strays = [...cells.keys()]
      .map((ref) => /^[A-Z]+/.exec(ref)![0])
      .filter((column) => !headerRefs.includes(column));
    expect([...new Set(strays)], "cells outside the header's columns").toEqual([]);

    // Typed, and that is the point of not comparing strings: an absent cell
    // reads back as null, `t="b"` as a boolean, an untyped one as a number.
    // A share count written as TEXT would satisfy any string assertion and
    // sum to zero in the spreadsheet.
    for (const [i, trade] of source.entries()) {
      const rowNumber = i + 2;
      expect(
        EXPORT_COLUMNS.map((_, col) => cells.get(`${columnRef(col)}${rowNumber}`) ?? null),
        `XLSX row ${rowNumber}: ${trade.txnDate} ${trade.company.ticker}`,
      ).toEqual(EXPORT_COLUMNS.map(([, read]) => read(trade)));
    }

    const nulls = nullsIn(source);
    assertNotDisclosedIsRepresented(nulls);
    for (const { row, col, name } of nulls) {
      expect(
        cells.has(`${columnRef(col)}${row + 2}`),
        `${name} is not disclosed on row ${row + 2}, so the cell must be ABSENT — a 0 there is a ` +
          "price AVERAGE() folds into a mean without asking",
      ).toBe(false);
    }
  });

  test("the export is of the FILTERED screen, not the whole tape", async ({ page }) => {
    // Both counts read from the same surface, so the comparison is between
    // two screens and not between a screen and a number written down here —
    // a reseed that changes the tape moves both and the test still means the
    // same thing.
    await page.goto(STABLE_SCREEN);
    await expect(page.getByTestId("result-count")).toBeVisible();
    const unfiltered = await readExactCount(page, "the unfiltered screen");

    await page.goto(FILTERED_SCREEN);
    await expect(page.getByTestId("result-count")).toBeVisible();
    const filtered = await readExactCount(page, `the ${FILTERED_TICKER} screen`);

    // Without this the rest is theatre: if the filter stopped removing
    // anything, "every row is ZZNOVA" would be a statement about the whole
    // tape and would hold with the filter ripped out of the export.
    expect(filtered, `no rows on the ${FILTERED_TICKER} screen to export`).toBeGreaterThan(0);
    expect(
      filtered,
      `the ${FILTERED_TICKER} filter removes nothing from this tape, so nothing below can tell a ` +
        "filtered export from an unfiltered one — pick a filter that bites",
    ).toBeLessThan(unfiltered);

    const { bytes, source } = await exportAndCapture(page, "CSV");
    const parsed = parseCsv(bytes.toString("utf8"));
    const header = parsed[0]!;
    const body = parsed.slice(1);

    // The count the reader was shown, against the number of lines they got.
    // This is the assertion that fails when the export re-queries without
    // the screen's parameters: the file arrives complete, correct, and about
    // a different question than the one on screen.
    expect(body.length, `the ${FILTERED_TICKER} screen showed ${filtered} rows`).toBe(filtered);
    expect(source.length, "the export fetched a different number of rows than it wrote").toBe(
      filtered,
    );

    const tickerColumn = header.indexOf("ticker");
    expect(
      tickerColumn,
      "the export has no ticker column to check the filter against",
    ).toBeGreaterThan(-1);
    for (const [i, cells] of body.entries()) {
      expect(cells[tickerColumn], `line ${i + 2} is a row the reader had filtered out`).toBe(
        FILTERED_TICKER,
      );
    }
  });
});

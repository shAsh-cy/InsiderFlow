import { describe, expect, it } from "vitest";

import { digestTelegram, telegramMessage } from "./format";
import type { AlertCandidate } from "./types";

/**
 * DOES TELEGRAM ACCEPT WHAT WE SEND IT?
 *
 * `escaping.test.ts` proves our escaper escapes. That is a property of
 * `escapeHtml`, and it is necessary. It is not the same question as
 * whether the finished message parses, and the two come apart in one
 * specific way that the existing tests cannot see.
 *
 * Telegram's HTML parse mode is not HTML. It accepts a CLOSED set of
 * about a dozen inline tags and rejects everything else with
 * `400 Bad Request: can't parse entities: Unsupported start tag`. The
 * whole delivery suite talks to a stub `fetchFn` that returns `{ok: true}`
 * for any bytes at all, so a template that grew a `<br>`, a `<div>`, or a
 * `<span style=...>` would send green tests and zero messages. Nothing in
 * this repository has ever checked the tag set.
 *
 * The same is true of stray punctuation. Telegram requires every `<`, `>`
 * and `&` that is not part of a tag or an entity to be escaped — so an
 * interpolation added later without `escapeHtml` around it fails at the
 * API, not at the type checker. That is the AT&T failure the escaper
 * exists for, seen from the other end: here it is caught in whatever the
 * TEMPLATE produced, rather than in a single call's return value.
 *
 * ── WHY AN ORACLE AND NOT A LIVE SEND ─────────────────────────────────
 *
 * A live send is the real proof and it needs a bot token, which is a
 * secret this test suite must not carry — and the project's token was
 * exposed and rotated, so there is not one to use. `scripts/send-live-
 * alert.mjs` performs that send when an operator supplies credentials,
 * and exits 2 rather than 0 when they are absent, because not measured is
 * not a pass. This file is what CI can run every time: the parser's
 * documented rules, applied to what the templates actually emit.
 */

/**
 * Telegram Bot API "HTML style", verbatim from the formatting-options
 * documentation. Listed rather than derived, because the point of the
 * check is that OUR set of tags cannot drift away from THEIRS.
 */
const TELEGRAM_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "span",
  "tg-spoiler",
  "a",
  "tg-emoji",
  "code",
  "pre",
  "blockquote",
]);

/**
 * `<span>` is on the list above and is nonetheless a trap: Telegram
 * accepts it ONLY as `<span class="tg-spoiler">` and rejects every other
 * form as an unsupported start tag. The first version of this oracle took
 * the tag list at face value and passed `<span style="color:red">`, which
 * is the exact markup a well-meaning change would introduce — so the
 * qualifier is enforced rather than assumed.
 */
const SPAN_SPOILER = /^span\s+class=["']tg-spoiler["']$/;

/** `&` is only legal when it opens an entity Telegram will decode. */
const ENTITY = /^&(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);/;

/**
 * Everything Telegram would reject in this string, in order.
 *
 * Returns a list rather than throwing so a failure names every problem at
 * once — a template regression usually breaks several lines identically,
 * and fixing them one test run at a time is how a five-minute repair
 * becomes an afternoon.
 */
function telegramViolations(html: string): string[] {
  const problems: string[] = [];
  const open: string[] = [];
  let i = 0;

  while (i < html.length) {
    const char = html[i];

    if (char === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        problems.push(`unterminated "<" at ${i}`);
        break;
      }
      const raw = html.slice(i + 1, end);
      const isClosing = raw.startsWith("/");
      // `?? ""` rather than `!`: `<>` is legal input to this function and
      // splits to an empty first element, which is not in the tag set and
      // is therefore reported rather than crashing the scan.
      const name = ((isClosing ? raw.slice(1) : raw).split(/[\s/]/, 1)[0] ?? "").toLowerCase();

      if (!TELEGRAM_TAGS.has(name)) {
        problems.push(`unsupported tag <${isClosing ? "/" : ""}${name}> at ${i}`);
      } else if (isClosing) {
        const expected = open.pop();
        if (expected !== name) {
          problems.push(`</${name}> at ${i} closes <${expected ?? "nothing"}>`);
        }
      } else {
        if (name === "span" && !SPAN_SPOILER.test(raw)) {
          problems.push(`<span> at ${i} is only supported as <span class="tg-spoiler">`);
        }
        // Tracked as open even when the attributes were wrong, so the
        // nesting check reports the one real fault instead of two.
        if (!raw.endsWith("/")) open.push(name);
      }
      i = end + 1;
      continue;
    }

    // A `>` outside a tag reached this point because no `<` opened one.
    if (char === ">") problems.push(`bare ">" at ${i}`);
    if (char === "&" && !ENTITY.test(html.slice(i))) problems.push(`bare "&" at ${i}`);
    i += 1;
  }

  if (open.length > 0) problems.push(`never closed: ${open.join(", ")}`);
  return problems;
}

const candidate = (over: Partial<AlertCandidate> = {}): AlertCandidate => ({
  id: "11111111-1111-4111-8111-111111111111",
  dedupKey: "zz-dedup",
  createdAt: new Date("2026-08-18T00:00:00Z"),
  txnDate: "2026-08-18",
  code: "P",
  shares: 1000,
  price: 10,
  value: 10000,
  valueUsd: 10000,
  currency: "USD",
  acquiredDisposed: "A",
  relevance: "high",
  source: "sec_edgar",
  country: "US",
  is10b51: false,
  companyId: "22222222-2222-4222-8222-222222222222",
  ticker: "ZZNOVA",
  companyName: "ZZ Nova Corp",
  insiderId: "33333333-3333-4333-8333-333333333333",
  insiderName: "ZZ Insider",
  insiderTitle: "CFO",
  ...over,
});

/**
 * The awkward cases, not the happy one. Every entry is a shape that has
 * either occurred in real filings or is a field a user types.
 */
const CASES: Array<[string, string, AlertCandidate]> = [
  ["an ordinary buy", "Large buys", candidate()],
  ["a sale", "Exits", candidate({ acquiredDisposed: "D", code: "S" })],
  ["an undisclosed direction", "Everything", candidate({ acquiredDisposed: null })],
  [
    // The ampersand case, on real data, with no attacker anywhere.
    "an issuer whose name contains &",
    "Consumer staples",
    candidate({ ticker: null, companyName: "Procter & Gamble Co" }),
  ],
  [
    "an issuer name carrying angle brackets",
    "Watchlist",
    candidate({ ticker: null, companyName: "Nova <Class B> Holdings & Co" }),
  ],
  [
    "a rule name the user typed, markup and all",
    'my rule " & <img src=x onerror=alert(1)>',
    candidate(),
  ],
  [
    "an insider title with a comma and an ampersand",
    "Officers",
    candidate({ insiderTitle: "EVP, Research & Development" }),
  ],
  [
    "a value nobody disclosed",
    "All filings",
    candidate({ value: null, valueUsd: null, shares: null }),
  ],
  ["a 10b5-1 sale", "Planned sales", candidate({ is10b51: true, acquiredDisposed: "D" })],
  [
    "a cluster alert, which renders a headline instead of a sentence",
    "Clusters",
    candidate({ kind: "cluster", headline: "4 insiders bought ZZNOVA in 7 days — $1.2M" }),
  ],
  [
    // Politician disclosures are brackets, and the en dash between the
    // bounds is the kind of character an escaper is not asked about.
    "a politician disclosure, which is a range",
    "Congress",
    candidate({
      kind: "politician",
      headline: "ZZ Representative disclosed a purchase of $1,001–$15,000",
      value: null,
      valueUsd: null,
    }),
  ],
];

describe("every Telegram message this product renders is one Telegram will parse", () => {
  it.each(CASES)("instant: %s", (_name, ruleName, c) => {
    const html = telegramMessage(ruleName, c);
    expect(telegramViolations(html), html).toEqual([]);
  });

  it("digest: every case above, in one message", () => {
    const html = digestTelegram(
      CASES.map(([name, ruleName, c]) => ({ ruleName: `${ruleName} (${name})`, candidates: [c] })),
    );
    expect(telegramViolations(html), html).toEqual([]);
  });

  it("digest: a group of many rows under one rule", () => {
    const html = digestTelegram([
      { ruleName: "Procter & Gamble <watch>", candidates: CASES.map(([, , c]) => c) },
    ]);
    expect(telegramViolations(html), html).toEqual([]);
  });
});

/**
 * THE ORACLE ITSELF, BROKEN ON PURPOSE.
 *
 * A checker that returns `[]` for everything would make every assertion
 * above pass while proving nothing, which is precisely the failure this
 * project keeps finding in its own tests. So each rule the oracle claims
 * to enforce is exercised against a string that violates it.
 */
describe("the oracle rejects what Telegram rejects", () => {
  it.each([
    ["<br> — the tag most likely to be added by habit", "line one<br>line two"],
    ["<div>, the reflex container", "<div>ZZNOVA</div>"],
    ["<span style>, which looks harmless and is not", '<span style="color:red">ZZ</span>'],
    ["<p>, from pasting email markup into the wrong renderer", "<p>ZZ Nova Corp</p>"],
    ["a bare ampersand", "Procter & Gamble"],
    ["a bare closing angle bracket", "shares > 1000"],
    ["an unterminated tag", "<b>ZZNOVA"],
    ["crossed tags", "<b><i>ZZNOVA</b></i>"],
    ["an entity that is not one", "AT&T; Inc"],
  ])("rejects %s", (_why, html) => {
    expect(telegramViolations(html)).not.toEqual([]);
  });

  it("accepts the tags Telegram documents, so the oracle is not merely strict", () => {
    expect(
      telegramViolations(
        "<b>bold</b> <i>italic</i> <u>under</u> <s>strike</s> <code>ZZ</code> " +
          '<a href="https://insiderflow.dev">link</a> <pre>block</pre> ' +
          "<blockquote>quoted</blockquote> AT&amp;T &lt;filed&gt; &quot;quoted&quot; &#8212;",
      ),
    ).toEqual([]);
  });
});

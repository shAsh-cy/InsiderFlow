import { describe, expect, it } from "vitest";

import { digestEmail, escapeHtml, instantEmail, telegramMessage } from "./format";
import type { AlertCandidate } from "./types";

/**
 * ESCAPING, WHERE THE PRODUCT ACTUALLY EMITS MARKUP.
 *
 * The web app is React, which escapes everything it interpolates, and
 * `dangerouslySetInnerHTML` appears nowhere in the tree — that half is
 * asserted structurally in `apps/web/src/lib/security/no-raw-html.test.ts`.
 *
 * This half is the part React does not cover. Telegram messages are sent
 * with `parse_mode: "HTML"` and the email bodies are hand-built strings,
 * so both are template concatenation into a markup context — the one place
 * this codebase builds HTML itself.
 *
 * The values that reach them are not ours. An issuer name, an insider
 * name, and a rule name a user typed all flow into these templates. An
 * issuer legitimately called `AT&T` already exercises the ampersand path
 * on real data, which is the useful reminder that this is not only about
 * attackers: unescaped `&` breaks Telegram's parser and the message fails
 * to send.
 */

const hostile = {
  ticker: "<script>alert(1)</script>",
  companyName: "Ampersand & Co <b>bold</b>",
  ruleName: 'my rule " & <img src=x onerror=alert(1)>',
};

describe("escapeHtml", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
  ])("escapes %s", (raw, encoded) => {
    expect(escapeHtml(raw)).toBe(encoded);
  });

  it("escapes the ampersand FIRST, so encodings are not double-encoded wrongly", () => {
    // `<` → `&lt;` introduces an ampersand. If `&` were replaced after,
    // that new ampersand would be re-escaped into `&amp;lt;` and the
    // reader would see the literal text `&lt;`.
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("leaves an already-safe string untouched", () => {
    expect(escapeHtml("Berkshire Hathaway Inc.")).toBe("Berkshire Hathaway Inc.");
  });

  it("handles the real-world case that is not an attack at all", () => {
    // AT&T files with the SEC. Unescaped, this breaks Telegram's HTML
    // parser and the alert simply never arrives.
    expect(escapeHtml("AT&T Inc.")).toBe("AT&amp;T Inc.");
  });
});

const candidate = (over: Partial<AlertCandidate> = {}): AlertCandidate =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    dedupKey: "zz-dedup",
    createdAt: new Date("2026-08-18T00:00:00Z"),
    valueUsd: 10000,
    acquiredDisposed: "A",
    country: "US",
    companyId: "22222222-2222-4222-8222-222222222222",
    insiderId: "33333333-3333-4333-8333-333333333333",
    insiderTitle: "CFO",
    ticker: "ZZNOVA",
    companyName: "ZZ Nova Corp",
    insiderName: "ZZ Insider",
    code: "P",
    direction: "buy",
    relevance: "high",
    txnDate: "2026-08-18",
    source: "sec_edgar",
    shares: 1000,
    price: 10,
    value: 10000,
    currency: "USD",
    is10b51: false,
    ...over,
  }) as AlertCandidate;

describe("the Telegram body is HTML, and is escaped as HTML", () => {
  it("neutralises a script tag in an issuer name", () => {
    const body = telegramMessage("a rule", candidate({ ticker: hostile.ticker }));
    expect(body, "a raw tag would be parsed by Telegram, not shown").not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("escapes a hostile rule name, which is the one field a user types", () => {
    const body = telegramMessage(hostile.ruleName, candidate());
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img");
  });

  it("keeps its own markup intact while escaping the values inside it", () => {
    // The template's own <b> and <code> must survive — an escaper applied
    // to the whole string instead of to each value would produce a message
    // showing literal tags to the reader.
    // `ticker: null` on purpose — the templates render `ticker ?? companyName`,
    // so with a ticker set the company name never reaches the output and the
    // assertion would be measuring the wrong field.
    const body = telegramMessage(
      "rule",
      candidate({ ticker: null, companyName: "Ampersand & Co" }),
    );
    expect(body).toContain("<b>");
    expect(body).toContain("&amp;");
  });
});

describe("the email bodies escape the same values", () => {
  it("instant email neutralises markup in a company name", () => {
    const { html } = instantEmail(
      "rule",
      candidate({ ticker: null, companyName: hostile.companyName }),
      {
        siteUrl: "https://insiderflow.dev",
        unsubscribeUrl: "https://insiderflow.dev/api/alerts/unsubscribe?token=zz",
      },
    );
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&amp;");
  });

  it("digest email escapes a hostile rule name", () => {
    const { html } = digestEmail([{ ruleName: hostile.ruleName, candidates: [candidate()] }], {
      siteUrl: "https://insiderflow.dev",
      unsubscribeUrl: "https://insiderflow.dev/api/alerts/unsubscribe?token=zz",
    });
    expect(html).not.toContain("onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});

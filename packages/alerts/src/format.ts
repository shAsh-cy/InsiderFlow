/**
 * Alert message rendering. Values are always shown as filed — a missing
 * value renders "undisclosed", never 0.
 *
 * Two destinations, one voice. Both are built in the same order — a heading
 * you can scan, then rows, then the caveat — because the alternative is a
 * paragraph of run-on text that nobody reads to the bottom of, and the bottom
 * is where "not investment advice" lives.
 */
import type { AlertCandidate } from "./types";

const compact = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2).replace(/\.?0+$/, "")}K`;
  return `${sign}${abs.toFixed(2).replace(/\.?0+$/, "")}`;
};

export function formatValue(candidate: AlertCandidate): string {
  if (candidate.valueUsd !== null) return `$${compact(candidate.valueUsd)}`;
  if (candidate.value !== null) return `${candidate.currency} ${compact(candidate.value)}`;
  return "undisclosed value";
}

export function tradeSummary(candidate: AlertCandidate): string {
  // Cluster/politician alerts arrive pre-summarised — they describe a group of
  // trades or a disclosure bracket, neither of which the sentence below fits.
  if (candidate.headline) return candidate.headline;
  const verb =
    candidate.acquiredDisposed === "A"
      ? "bought"
      : candidate.acquiredDisposed === "D"
        ? "sold"
        : "reported";
  const shares =
    candidate.shares === null
      ? "an undisclosed number of"
      : candidate.shares.toLocaleString("en-US");
  const symbol = candidate.ticker ?? candidate.companyName;
  return `${candidate.insiderName}${candidate.insiderTitle ? ` (${candidate.insiderTitle})` : ""} ${verb} ${shares} ${symbol} shares — ${formatValue(candidate)}`;
}

/**
 * Escape for Telegram's HTML parse mode and for email HTML.
 *
 * EVERY interpolation of company, insider, or user-supplied text into a
 * rendered message must go through this. Telegram's HTML mode accepts only a
 * small tag whitelist and rejects malformed entities with
 * `400 Bad Request: can't parse entities` — so an unescaped `&` is not a
 * cosmetic bug, it is a message that never sends. Issuer names carrying `&`
 * are routine (AT&T, Procter & Gamble, Johnson & Johnson), so this fires on
 * ordinary data with no attacker involved.
 *
 * Exported so every renderer in this package shares one implementation
 * rather than each remembering to write its own.
 */
export const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Direction as a SHAPE, never as a colour alone.
 *
 * Mail clients recolour text at will — forced dark mode inverts it, Gmail's
 * clipping drops the styles, corporate gateways strip CSS outright — so
 * buy/sell has to survive with every colour removed. Telegram has the same
 * problem for a different reason: it has no colour to give. The triangle is
 * that non-colour channel, and it is the only glyph these messages spend.
 *
 * A direction nobody disclosed is an em dash — the app's null mark — not a
 * guess in one direction or the other.
 */
const directionGlyph = (c: AlertCandidate): string =>
  c.acquiredDisposed === "A" ? "▲" : c.acquiredDisposed === "D" ? "▼" : "—";

/**
 * The badge beside the symbol: cluster and politician alerts name themselves,
 * an ordinary trade shows its SEC code. One helper so the instant card and the
 * digest cannot drift apart on what a row calls itself.
 */
const badgeFor = (c: AlertCandidate): string =>
  c.kind && c.kind !== "transaction" ? c.kind : c.code;

// ── Telegram ────────────────────────────────────────────────────────────────
//
// Telegram gives us four inline tags and a monospace face. <code> is used for
// the things a reader scans down a column — symbols and codes — because
// monospace is the only alignment tool the medium has.

/** Telegram message (HTML parse mode). */
export function telegramMessage(ruleName: string, candidate: AlertCandidate): string {
  const lines = [
    `${directionGlyph(candidate)} <b>${escapeHtml(candidate.ticker ?? candidate.companyName)}</b> · <code>${escapeHtml(badgeFor(candidate))}</code>`,
    escapeHtml(tradeSummary(candidate)),
    `<i>${escapeHtml(candidate.txnDate)} · ${escapeHtml(candidate.relevance)}${candidate.is10b51 ? " · 10b5-1" : ""} · via ${escapeHtml(candidate.source)}</i>`,
    `Rule: ${escapeHtml(ruleName)}`,
    "",
    "<i>Not investment advice.</i>",
  ];
  return lines.join("\n");
}

export interface DigestGroup {
  ruleName: string;
  candidates: AlertCandidate[];
}

/**
 * Digest as a Telegram message — the fallback when a user has Telegram
 * verified but no email configured.
 *
 * Lives here, next to the other renderers, rather than inline in dispatch.ts.
 * It was inline, and it was the one path in the package that interpolated
 * `ruleName`, `ticker`, and `companyName` raw into an HTML payload.
 *
 * The triangle doubles as the bullet: one glyph carrying two jobs beats two
 * glyphs, and a digest of twenty rows is where emoji noise compounds fastest.
 */
export function digestTelegram(groups: DigestGroup[]): string {
  const total = groups.reduce((sum, g) => sum + g.candidates.length, 0);
  const summary = groups
    .map((g) => {
      const items = g.candidates
        .map(
          (c) =>
            `${directionGlyph(c)} <code>${escapeHtml(c.ticker ?? c.companyName)}</code> · ${escapeHtml(
              badgeFor(c),
            )}`,
        )
        .join("\n");
      return `<b>${escapeHtml(g.ruleName)}</b>\n${items}`;
    })
    .join("\n\n");
  return [
    `<b>InsiderFlow digest</b> — ${total} ${total === 1 ? "alert" : "alerts"}`,
    "",
    summary,
    "",
    "<i>Not investment advice.</i>",
  ].join("\n");
}

// ── Email ───────────────────────────────────────────────────────────────────
//
// Ledger, inlined. Email is the one place in this product where a literal hex
// value is correct: there is no stylesheet, no custom property, and no
// webfont that survives a mail client. These are the exact token values from
// apps/web/src/app/globals.css, copied so the digest reads as the same
// document as the app rather than merely near it.

const PAPER = "#FBFAF7"; // --bg
const INK = "#17150F"; // --ink
const INK_MUTED = "#6B6659"; // --ink-muted
const INK_FAINT = "#9B9689"; // --ink-faint
const RULE = "#E4E1D9"; // --border
/**
 * The one accent. Spent exactly once per message, on the single thing the
 * reader can act on — the way back into the product. The caveat is carried by
 * weight instead, because bold survives a client that strips colour and a
 * colour-blind reader alike; the design language's rule is that colour never
 * carries meaning on its own.
 */
const OXBLOOD = "#8A2B2B"; // --accent

// No webfonts: a mail client either has the face installed or it does not, and
// @font-face is stripped by most of them. Onest and IBM Plex Mono are named
// first anyway so the two clients that do have them render the real thing.
const SANS = "Onest,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

/** Figures must align digit-for-digit down a column; proportional digits do not. */
const TNUM = "font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1";
const HAIRLINE = `1px solid ${RULE}`;

/**
 * Declared light-only on purpose. Ledger is warm paper; the app's dark theme
 * has hand-tuned ink tones that no mail client will ever load. Saying "light"
 * out loud is what stops Outlook and Gmail from inventing their own inversion
 * — they invert anyway if we say nothing, and their guess mangles hairlines.
 */
const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`;

/**
 * The outer scaffold. Tables and inline styles, not divs and classes: Outlook
 * renders through Word, which has no flexbox and no `max-width`.
 */
const shell = (body: string): string =>
  `<body style="margin:0;padding:0;background:${PAPER};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="border-collapse:collapse;background:${PAPER}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;text-align:left">
${body}
</table>
</td></tr></table>
</body>`;

/** The closing block: what this data is, what it is not, and the way out. */
const footer = (options: { siteUrl: string; unsubscribeUrl: string }, lead: string): string =>
  `<tr><td style="padding-top:22px;font-family:${SANS};font-size:12px;line-height:18px;color:${INK_MUTED}">
${lead} <strong style="color:${INK}">Not investment advice.</strong><br>
<a href="${escapeHtml(options.siteUrl)}" style="color:${OXBLOOD};text-decoration:underline">Open InsiderFlow</a> ·
<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:${INK_MUTED};text-decoration:underline">Unsubscribe</a>
</td></tr>`;

/** Digest email: one send covering every pending alert for a user. */
export function digestEmail(
  groups: DigestGroup[],
  options: { siteUrl: string; unsubscribeUrl: string },
): { subject: string; html: string; text: string } {
  const total = groups.reduce((sum, g) => sum + g.candidates.length, 0);
  const subject = `InsiderFlow digest — ${total} ${total === 1 ? "alert" : "alerts"}`;

  // One <tr> per alert, ruled like a ledger: a hairline under every row, the
  // date right-aligned in mono so the dates read straight down the edge. No
  // bullets — the direction triangle already marks where a row starts.
  const sections = groups
    .map((group) => {
      const rows = group.candidates
        .map(
          (c) =>
            `<tr>` +
            `<td valign="top" style="padding:8px 10px 8px 0;border-bottom:${HAIRLINE};font-family:${MONO};font-size:13px;line-height:18px;color:${INK}">${directionGlyph(c)}</td>` +
            `<td valign="top" style="padding:8px 10px 8px 0;border-bottom:${HAIRLINE};font-family:${MONO};font-size:13px;line-height:18px;${TNUM};color:${INK}">${escapeHtml(tradeSummary(c))}</td>` +
            `<td valign="top" align="right" style="padding:8px 0;border-bottom:${HAIRLINE};font-family:${MONO};font-size:12px;line-height:18px;${TNUM};color:${INK_FAINT};white-space:nowrap">${escapeHtml(c.txnDate)}</td>` +
            `</tr>`,
        )
        .join("");
      return (
        `<tr><td style="padding:22px 0 6px"><h3 style="margin:0;font-family:${SANS};font-size:13px;line-height:18px;font-weight:600;color:${INK}">${escapeHtml(group.ruleName)}</h3></td></tr>` +
        `<tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">${rows}</table></td></tr>`
      );
    })
    .join("");

  const html = `<!doctype html><html><head>${HEAD}<title>${escapeHtml(subject)}</title></head>
${shell(
  `<tr><td style="padding-bottom:2px"><h1 style="margin:0;font-family:${SANS};font-size:18px;line-height:26px;font-weight:600;letter-spacing:-0.01em;color:${INK}">InsiderFlow digest</h1></td></tr>
<tr><td style="padding-bottom:14px;border-bottom:${HAIRLINE}"><p style="margin:0;font-family:${SANS};font-size:13px;line-height:18px;color:${INK_MUTED}">${total} ${total === 1 ? "alert" : "alerts"} across ${groups.length} ${groups.length === 1 ? "rule" : "rules"}.</p></td></tr>
${sections}
${footer(options, "This is public regulatory filing data, republished for research and education.")}`,
)}
</html>`;

  // The plain-text part is already monospaced by every reader that renders it,
  // so putting the date first is all the column alignment it needs.
  const text = [
    subject,
    `${total} ${total === 1 ? "alert" : "alerts"} across ${groups.length} ${groups.length === 1 ? "rule" : "rules"}.`,
    "",
    ...groups.flatMap((g) => [
      g.ruleName,
      ...g.candidates.map((c) => `  ${directionGlyph(c)} ${c.txnDate}  ${tradeSummary(c)}`),
      "",
    ]),
    "This is public regulatory filing data, republished for research and education.",
    "Not investment advice.",
    `Unsubscribe: ${options.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Instant email — reserved for rules that explicitly opted in (Resend free tier is 100/day). */
export function instantEmail(
  ruleName: string,
  candidate: AlertCandidate,
  options: { siteUrl: string; unsubscribeUrl: string },
): { subject: string; html: string; text: string } {
  const symbol = candidate.ticker ?? candidate.companyName;
  const subject = `${symbol}: ${tradeSummary(candidate)}`.slice(0, 120);
  // Same meta line in both parts. It used to differ, which meant the plain-text
  // reader silently got less than the HTML one.
  const meta = `${candidate.txnDate} · code ${candidate.code} · ${candidate.relevance}${candidate.is10b51 ? " · 10b5-1 plan" : ""}`;

  // Three steps down: which rule fired, what instrument, what happened. The
  // symbol gets its own mono line because that is what a reader opening this
  // from a phone notification is looking for.
  const html = `<!doctype html><html><head>${HEAD}<title>${escapeHtml(subject)}</title></head>
${shell(
  `<tr><td style="padding-bottom:12px;border-bottom:${HAIRLINE}">
<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:16px;color:${INK_MUTED}">${escapeHtml(ruleName)}</p>
<p style="margin:0 0 8px;font-family:${MONO};font-size:16px;line-height:24px;${TNUM};color:${INK}">${directionGlyph(candidate)} ${escapeHtml(symbol)}</p>
<h1 style="margin:0;font-family:${SANS};font-size:18px;line-height:26px;font-weight:600;letter-spacing:-0.01em;color:${INK}">${escapeHtml(tradeSummary(candidate))}</h1>
</td></tr>
<tr><td style="padding-top:10px;font-family:${MONO};font-size:12px;line-height:18px;${TNUM};color:${INK_MUTED}">${escapeHtml(meta)}</td></tr>
${footer(options, "Public regulatory filing data.")}`,
)}
</html>`;

  const text = [
    ruleName,
    `${directionGlyph(candidate)} ${symbol}`,
    tradeSummary(candidate),
    meta,
    "",
    "Not investment advice.",
    `Unsubscribe: ${options.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

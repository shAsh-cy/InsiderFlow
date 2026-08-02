/**
 * Alert message rendering. Values are always shown as filed — a missing
 * value renders "undisclosed", never 0.
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

const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Telegram message (HTML parse mode). */
export function telegramMessage(ruleName: string, candidate: AlertCandidate): string {
  const arrow = candidate.acquiredDisposed === "D" ? "🔻" : "🟢";
  const lines = [
    `${arrow} <b>${escapeHtml(candidate.ticker ?? candidate.companyName)}</b> · <code>${escapeHtml(candidate.code)}</code>`,
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

/** Digest email: one send covering every pending alert for a user. */
export function digestEmail(
  groups: DigestGroup[],
  options: { siteUrl: string; unsubscribeUrl: string },
): { subject: string; html: string; text: string } {
  const total = groups.reduce((sum, g) => sum + g.candidates.length, 0);
  const subject = `InsiderFlow digest — ${total} ${total === 1 ? "alert" : "alerts"}`;

  const sections = groups
    .map((group) => {
      const items = group.candidates
        .map(
          (c) =>
            `<li style="margin:6px 0;color:#c9d1e1">${escapeHtml(tradeSummary(c))} <span style="color:#7b8496">(${escapeHtml(c.txnDate)})</span></li>`,
        )
        .join("");
      return `<h3 style="margin:20px 0 6px;font-size:14px;color:#eef1f8">${escapeHtml(group.ruleName)}</h3><ul style="margin:0;padding-left:18px">${items}</ul>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0b0f;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto">
<h1 style="font-size:18px;color:#eef1f8;margin:0 0 4px">InsiderFlow digest</h1>
<p style="color:#96a0b5;font-size:13px;margin:0 0 8px">${total} ${total === 1 ? "alert" : "alerts"} across ${groups.length} ${groups.length === 1 ? "rule" : "rules"}.</p>
${sections}
<p style="margin-top:28px;color:#6b7386;font-size:11px;line-height:1.6">
This is public regulatory filing data, republished for research and education. <strong>Not investment advice.</strong><br>
<a href="${escapeHtml(options.siteUrl)}" style="color:#2de0c8">Open InsiderFlow</a> ·
<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#6b7386">Unsubscribe</a>
</p></div></body></html>`;

  const text = [
    `InsiderFlow digest — ${total} ${total === 1 ? "alert" : "alerts"}`,
    "",
    ...groups.flatMap((g) => [
      g.ruleName,
      ...g.candidates.map((c) => `  - ${tradeSummary(c)} (${c.txnDate})`),
      "",
    ]),
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
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#0a0b0f;font-family:system-ui,sans-serif">
<div style="max-width:600px;margin:0 auto">
<p style="color:#96a0b5;font-size:12px;margin:0 0 6px">${escapeHtml(ruleName)}</p>
<h1 style="font-size:17px;color:#eef1f8;margin:0 0 10px">${escapeHtml(tradeSummary(candidate))}</h1>
<p style="color:#96a0b5;font-size:13px">${escapeHtml(candidate.txnDate)} · code ${escapeHtml(candidate.code)} · ${escapeHtml(candidate.relevance)}${candidate.is10b51 ? " · 10b5-1 plan" : ""}</p>
<p style="margin-top:24px;color:#6b7386;font-size:11px;line-height:1.6">
Public regulatory filing data. <strong>Not investment advice.</strong><br>
<a href="${escapeHtml(options.siteUrl)}" style="color:#2de0c8">Open InsiderFlow</a> ·
<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#6b7386">Unsubscribe</a>
</p></div></body></html>`;
  const text = `${ruleName}\n${tradeSummary(candidate)}\n${candidate.txnDate} · ${candidate.code}\n\nNot investment advice.\nUnsubscribe: ${options.unsubscribeUrl}`;
  return { subject, html, text };
}

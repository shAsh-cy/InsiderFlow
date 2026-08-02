/**
 * Pure rule matching. The scanner pre-filters candidates in SQL using the
 * SHARED filter builder (so a saved screen matches exactly as it does on
 * the screener page); this module applies the per-rule predicates that are
 * cheap to evaluate in memory, plus quiet-hours resolution.
 */
import type { AlertCandidate, MatchableRule } from "./types";

/** Filters evaluable on a single row without touching the database. */
export function candidateMatchesFilters(
  candidate: AlertCandidate,
  filters: Record<string, unknown> | null,
): boolean {
  if (!filters) return true;
  const f = filters as {
    market?: string;
    ticker?: string;
    code?: string;
    relevance?: string;
    source?: string;
    side?: "buy" | "sell";
    min_value_usd?: number;
    min_value?: number;
    from?: string;
    to?: string;
  };

  if (f.market && candidate.country !== f.market) return false;
  if (f.ticker && candidate.ticker !== f.ticker.toUpperCase()) return false;
  if (f.code && candidate.code !== f.code) return false;
  if (f.relevance && candidate.relevance !== f.relevance) return false;
  if (f.source && candidate.source !== f.source) return false;
  if (f.side === "buy" && candidate.acquiredDisposed !== "A") return false;
  if (f.side === "sell" && candidate.acquiredDisposed !== "D") return false;
  if (f.from && candidate.txnDate < f.from) return false;
  if (f.to && candidate.txnDate > f.to) return false;
  // A missing value can never satisfy a minimum — never assume zero.
  if (f.min_value_usd !== undefined) {
    if (candidate.valueUsd === null || candidate.valueUsd < f.min_value_usd) return false;
  }
  if (f.min_value !== undefined) {
    if (candidate.value === null || candidate.value < f.min_value) return false;
  }
  return true;
}

export function ruleMatches(rule: MatchableRule, candidate: AlertCandidate): boolean {
  if (!rule.enabled) return false;
  if (rule.trackedTicker && candidate.ticker !== rule.trackedTicker.toUpperCase()) return false;
  if (rule.trackedInsiderId && candidate.insiderId !== rule.trackedInsiderId) return false;
  return candidateMatchesFilters(candidate, rule.filters as Record<string, unknown> | null);
}

const toMinutes = (hhmm: string): number | null => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * Quiet hours in the user's local time. Windows may wrap midnight
 * (22:00 → 07:00), in which case "inside" means after the start OR before
 * the end.
 */
export function isWithinQuietHours(
  start: string | null,
  end: string | null,
  localMinutes: number,
): boolean {
  if (!start || !end) return false;
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || from === to) return false;
  return from < to
    ? localMinutes >= from && localMinutes < to
    : localMinutes >= from || localMinutes < to;
}

/** Minutes since local midnight for an IANA timezone (falls back to UTC). */
export function localMinutesIn(timezone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return (hour % 24) * 60 + minute;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

/**
 * Effective delivery mode. An instant rule inside its quiet window is
 * downgraded to the digest rather than dropped — the alert still arrives,
 * just at a civilized hour.
 */
export function effectiveMode(
  rule: MatchableRule,
  timezone: string,
  at: Date,
): "instant" | "digest" {
  if (rule.mode !== "instant") return "digest";
  const minutes = localMinutesIn(timezone, at);
  return isWithinQuietHours(rule.quietHoursStart, rule.quietHoursEnd, minutes)
    ? "digest"
    : "instant";
}

export {
  acquireLease,
  fetchCandidates,
  isStaleForInstant,
  releaseLease,
  scanForMatches,
} from "./scanner";
export type { ScanOptions, ScanResult } from "./scanner";
export {
  clusterAlertKey,
  politicianAlertKey,
  POLITICIAN_CURSOR_KEY,
  scanClusterAlerts,
  scanPoliticianAlerts,
} from "./derived-scanners";
export type {
  ClusterRuleFilters,
  DerivedScanOptions,
  DerivedScanResult,
  PoliticianRuleFilters,
} from "./derived-scanners";
export {
  dispatchDigest,
  dispatchDigestExclusive,
  dispatchInstant,
  MAX_DELIVERY_ATTEMPTS,
  pendingCount,
} from "./dispatch";
export type { DispatchConfig, DispatchStats } from "./dispatch";
export { DIGEST_LEASE, lastRunAgeSeconds, leaseState, withLease } from "./lease";
export type { LeaseResult } from "./lease";
export {
  candidateMatchesFilters,
  effectiveMode,
  isWithinQuietHours,
  localMinutesIn,
  ruleMatches,
} from "./match";
export { isPermanentTelegramStatus, sendEmail, sendTelegram, telegramLinkUrl } from "./channels";
export type { FetchLike, ResendConfig, TelegramConfig } from "./channels";
export {
  digestEmail,
  digestTelegram,
  escapeHtml,
  formatValue,
  instantEmail,
  telegramMessage,
  tradeSummary,
} from "./format";
export type { DigestGroup } from "./format";
export type {
  AlertCandidate,
  AlertKind,
  AlertMatch,
  ChannelTarget,
  DispatchResult,
  Logger,
  MatchableRule,
} from "./types";

export { acquireLease, fetchCandidates, releaseLease, scanForMatches } from "./scanner";
export type { ScanOptions, ScanResult } from "./scanner";
export { dispatchDigest, dispatchInstant, pendingCount } from "./dispatch";
export type { DispatchConfig, DispatchStats } from "./dispatch";
export {
  candidateMatchesFilters,
  effectiveMode,
  isWithinQuietHours,
  localMinutesIn,
  ruleMatches,
} from "./match";
export { sendEmail, sendTelegram, telegramLinkUrl } from "./channels";
export type { FetchLike, ResendConfig, TelegramConfig } from "./channels";
export { digestEmail, formatValue, instantEmail, telegramMessage, tradeSummary } from "./format";
export type { DigestGroup } from "./format";
export type {
  AlertCandidate,
  AlertMatch,
  ChannelTarget,
  DispatchResult,
  Logger,
  MatchableRule,
} from "./types";

import type { TradeFilterInput } from "@insiderflow/db";

export type AlertKind = "transaction" | "cluster" | "politician";

/**
 * A transaction as the scanner sees it, joined with display context.
 *
 * Cluster and politician alerts reuse this shape with `headline` set, so the
 * whole rendering + digest-grouping path stays one code path. Their rows have
 * no transaction to join against, so they persist a serialized candidate in
 * alerts_log.payload instead.
 */
export interface AlertCandidate {
  id: string;
  dedupKey: string;
  createdAt: Date;
  txnDate: string;
  code: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  valueUsd: number | null;
  currency: string;
  acquiredDisposed: string | null;
  relevance: string;
  source: string;
  country: string;
  is10b51: boolean;
  companyId: string;
  ticker: string | null;
  companyName: string;
  insiderId: string;
  insiderName: string;
  insiderTitle: string | null;
  /** Filing acceptance time — the freshness clock for instant delivery. */
  filedAt?: Date | null;
  /** Set for cluster/politician alerts; replaces the generated trade sentence. */
  headline?: string | null;
  kind?: AlertKind;
}

export interface MatchableRule {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  filters: TradeFilterInput | null;
  trackedTicker: string | null;
  trackedInsiderId: string | null;
  kind: AlertKind;
  mode: "instant" | "digest";
  channels: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface AlertMatch {
  rule: MatchableRule;
  candidate: AlertCandidate;
  /** Effective mode after quiet-hours and freshness evaluation. */
  mode: "instant" | "digest";
  /** Why an instant rule was downgraded, if it was. */
  deferReason?: "quiet_hours" | "stale" | null;
}

export type Logger = (event: string, data?: Record<string, unknown>) => void;

export interface ChannelTarget {
  channel: string;
  destination: string;
  verified: boolean;
  unsubscribeToken: string | null;
}

export interface DispatchResult {
  channel: string;
  ok: boolean;
  error?: string;
  /**
   * The provider rejected this message and will reject it again unchanged.
   * Retrying is pointless; the row is retired as `failed_permanent` instead of
   * sitting `pending` forever. Absent/false means "retry, within the cap".
   */
  permanent?: boolean;
}

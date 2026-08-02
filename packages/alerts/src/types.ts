import type { TradeFilterInput } from "@insiderflow/db";

/** A transaction as the scanner sees it, joined with display context. */
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
}

export interface MatchableRule {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  filters: TradeFilterInput | null;
  trackedTicker: string | null;
  trackedInsiderId: string | null;
  mode: "instant" | "digest";
  channels: string[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface AlertMatch {
  rule: MatchableRule;
  candidate: AlertCandidate;
  /** Effective mode after quiet-hours evaluation. */
  mode: "instant" | "digest";
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
}

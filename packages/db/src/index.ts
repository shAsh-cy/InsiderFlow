export { createDb, createDbHandle } from "./client";
export type { Database, DatabaseHandle } from "./client";
export * from "./schema";
export {
  anomalyCondition,
  buildTradeConditions,
  clusterCompaniesFromFlags,
  clusterCompaniesSubquery,
  clusterCondition,
  clusterFallbackActive,
  clusterFlagStatus,
  cutoffIso,
  dipCondition,
  excludeSynthetic,
  nearLowCondition,
  resolveClusterSource,
  showSyntheticData,
} from "./trade-filters";
export type { ClusterSource, TradeFilterInput } from "./trade-filters";
export {
  CAPABILITY_SETTING,
  setLocalSetting,
  USER_ID_SETTING,
  withCapability,
  withUserContext,
  withUserContextAsApp,
  APP_ROLE,
} from "./user-context";
export type { ScopedDb } from "./user-context";
// Re-export the query operators so consumers use a single drizzle-orm instance.
export {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

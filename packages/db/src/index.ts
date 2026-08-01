export { createDb, createDbHandle } from "./client";
export type { Database, DatabaseHandle } from "./client";
export * from "./schema";
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

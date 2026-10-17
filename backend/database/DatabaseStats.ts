import { createHash } from "node:crypto";

import { logEvent } from "@/backend/logging/Logger";
import { recordDatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import { readSlowOperationThresholdMs } from "@/backend/logging/LogTiming";

/** Aggregate counters describing database access since the last reset. */
export interface DatabaseStats {
  readonly queries: number;
  readonly totalMs: number;
}

const counters = {
  queries: 0,
  totalMs: 0,
};

/** Resets the aggregate database counters, e.g. around a measurement. */
export function resetDatabaseStats(): void {
  counters.queries = 0;
  counters.totalMs = 0;
}

/** Returns a snapshot of the aggregate database counters. */
export function readDatabaseStats(): DatabaseStats {
  return { queries: counters.queries, totalMs: counters.totalMs };
}

/**
 * Records one finished statement for aggregate analysis.
 *
 * @remarks
 * Counting stays always on because two additions per query are negligible
 * next to DuckDB itself. Statements log an operation and stable hash, never
 * SQL text or parameter values. Ordinary statements contribute to enclosing
 * operation totals; only slow statements also emit an individual warning.
 *
 * @param statement - SQL text of the finished statement.
 * @param durationMs - Wall-clock duration of the statement.
 */
export function recordDatabaseQuery(
  statement: string,
  durationMs: number,
): void {
  counters.queries += 1;
  counters.totalMs += durationMs;

  const operation =
    /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|CHECKPOINT|BEGIN|COMMIT|ROLLBACK|SET|WITH)\b/iu
      .exec(statement)?.[1]
      ?.toUpperCase() ?? "OTHER";
  const statementId = createHash("sha256")
    .update(statement)
    .digest("hex")
    .slice(0, 16);
  recordDatabaseLogMetrics(operation, statementId, durationMs);
  if (durationMs < readSlowOperationThresholdMs()) return;
  logEvent({
    level: "warn",
    event: "database.statement.slow",
    component: "Database",
    message: "Database statement exceeded the slow-statement threshold",
    metadata: { operation, statementId, durationMs },
  });
}

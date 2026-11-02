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

/** Time of a statement outside DuckDB and write-ahead log sizes around it (PAGE-197). */
export interface DatabaseStatementBreakdown {
  /** Connection the statement ran on. */
  readonly role: "writer" | "reader";
  /** Wait for a free reader connection inside the worker. */
  readonly workerWaitMs: number;
  /** Round trip minus worker time: serialization and IPC transfer. */
  readonly ipcMs: number;
  /** Write-ahead log size before a COMMIT or CHECKPOINT. */
  readonly walBytesBefore: number | null;
  /** Write-ahead log size after it; a shrunken log means DuckDB checkpointed. */
  readonly walBytesAfter: number | null;
}

function describeBreakdown(
  breakdown: DatabaseStatementBreakdown,
): Record<string, string | number | boolean | null> {
  const { walBytesBefore, walBytesAfter } = breakdown;
  return {
    role: breakdown.role,
    workerWaitMs: Math.round(breakdown.workerWaitMs),
    ipcMs: Math.round(breakdown.ipcMs),
    walBytesBefore,
    walBytesAfter,
    checkpointed:
      walBytesBefore === null || walBytesAfter === null
        ? null
        : walBytesAfter < walBytesBefore,
  };
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
 * @param durationMs - Execution of the statement inside DuckDB, measured by
 * the database worker; queue wait and IPC transfer are not part of it.
 * @param breakdown - Where else the statement spent time, when known.
 */
export function recordDatabaseQuery(
  statement: string,
  durationMs: number,
  breakdown?: DatabaseStatementBreakdown,
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
    metadata: {
      operation,
      statementId,
      durationMs,
      ...(breakdown ? describeBreakdown(breakdown) : {}),
    },
  });
}

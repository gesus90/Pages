/** Aggregate counters describing database access since the last reset. */
export interface DatabaseStats {
  readonly queries: number;
  readonly totalMs: number;
}

const counters = {
  queries: 0,
  totalMs: 0,
};

function readSlowQueryThresholdMs(): number {
  const parsed =
    process.env.PAGES_SLOW_QUERY_MS === undefined
      ? Number.NaN
      : Number(process.env.PAGES_SLOW_QUERY_MS);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
}

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
 * next to SQLite itself. Individual statements are only logged in
 * development when they exceed `PAGES_SLOW_QUERY_MS` (default 50ms), so
 * production logs stay clean.
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

  if (process.env.NODE_ENV !== "development") {
    return;
  }

  if (durationMs < readSlowQueryThresholdMs()) {
    return;
  }

  const preview = statement.replace(/\s+/g, " ").trim().slice(0, 120);
  console.warn(`[pages][slow-query] ${durationMs.toFixed(1)}ms ${preview}`);
}

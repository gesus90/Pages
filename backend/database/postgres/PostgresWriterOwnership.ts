import { setTimeout as wait } from "node:timers/promises";

import { recordDatabaseWaitMetrics } from "@/backend/logging/DatabaseLogMetrics";
import { logCaughtError } from "@/backend/logging/Logger";

import { DatabaseOverloadedError } from "../executor/DatabaseExecutorErrors";
import { DATABASE_EXECUTOR_LIMITS } from "../executor/DatabaseExecutorLimits";
import { currentDatabaseWork } from "../executor/DatabaseWorkContext";

import type { PostgresConnection } from "./PostgresConnection";

const TRY_WRITER =
  "SELECT CASE WHEN pg_try_advisory_lock(1346455365, 0) THEN 1 ELSE 0 END AS owned;";
const RELEASE_WRITER = "SELECT pg_advisory_unlock(1346455365, 0);";

/** Extends the repository writer lane across API, run, integration and independent owner processes. */
export async function withPostgresWriterOwnership<Result>(
  connection: PostgresConnection,
  work: () => Promise<Result>,
): Promise<Result> {
  await acquireWriter(connection);
  let result: Result;
  try {
    result = await work();
  } catch (error: unknown) {
    try {
      await releaseWriter(connection);
    } catch (releaseError: unknown) {
      logCaughtError("PostgresWriterOwnership", releaseError);
    }
    throw error;
  }
  await releaseWriter(connection);
  return result;
}

async function acquireWriter(connection: PostgresConnection): Promise<void> {
  const context = currentDatabaseWork();
  const budget =
    context.workClass === "request"
      ? DATABASE_EXECUTOR_LIMITS.requestWriteQueueBudgetMs
      : DATABASE_EXECUTOR_LIMITS.backgroundWriteQueueBudgetMs;
  const startedAt = performance.now();
  while (performance.now() - startedAt < budget) {
    if (context.signal?.aborted) throw new DatabaseOverloadedError("aborted");
    const rows = await connection.run(TRY_WRITER, {}, "rows");
    if (rows[0]?.[0] === 1) {
      recordDatabaseWaitMetrics(0, performance.now() - startedAt);
      return;
    }
    await wait(20);
  }
  throw new DatabaseOverloadedError("queue_timeout");
}

async function releaseWriter(connection: PostgresConnection): Promise<void> {
  try {
    await connection.run(RELEASE_WRITER, {}, "execute");
  } catch (error: unknown) {
    connection.discard();
    throw error;
  }
}

import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { logEvent } from "@/backend/logging/Logger";

import {
  PLAN_RUN_SETTLEMENT_RULES,
  SETTLED_PLAN_RUN,
} from "./AgentPlanRunRetention";

import type { Database } from "@/backend/database/Database";

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

const REASONS = PLAN_RUN_SETTLEMENT_RULES.map(
  (rule) => `CASE WHEN NOT (${rule.condition}) THEN '${rule.reason}' END`,
).join(",\n          ");

/** Persists increasing retry delays and an hourly log fence across service restarts. */
export async function deferPlanRunPurge(
  database: Pick<Database, "transaction">,
  keptRunId: string,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const storageName = `plan-runs/${keptRunId}`;
    const [entry] = await transaction.query(
      `
      SELECT
          retry_count,
          last_deferred_log_at
      FROM agent_payload_garbage
      WHERE storage_name = $storage_name
      FOR UPDATE;
    `,
      { storage_name: storageName },
    );
    if (!entry) return;
    const now = Date.now();
    const attempts = readCountColumn(entry, 0, "retry_count");
    const lastLogAt = readCountColumn(entry, 1, "last_deferred_log_at");
    const shouldLog = lastLogAt === 0 || now - lastLogAt >= HOUR_MS;
    await transaction.execute(
      `
      UPDATE agent_payload_garbage
      SET retry_count = $retry_count,
          retry_after = $retry_after,
          last_deferred_log_at = $last_log_at
      WHERE storage_name = $storage_name;
    `,
      {
        storage_name: storageName,
        retry_count: Math.min(attempts + 1, 16),
        retry_after:
          now + Math.min(HOUR_MS, MINUTE_MS * 2 ** Math.min(attempts, 6)),
        last_log_at: shouldLog ? now : lastLogAt,
      },
    );
    if (!shouldLog) return;
    const blocked = await transaction.query(
      `
      SELECT
          runs.id,
          concat_ws(', ', ${REASONS}) AS reasons
      FROM agent_plan_runs AS runs
      INNER JOIN agent_plan_runs AS kept ON kept.plan_id = runs.plan_id
      WHERE kept.id = $kept_run_id
          AND (runs.started_at, runs.id) < (kept.started_at, kept.id)
          AND NOT (${SETTLED_PLAN_RUN})
      ORDER BY runs.started_at, runs.id
      LIMIT 64;
    `,
      { kept_run_id: keptRunId },
    );
    const reasons = blocked
      .map(
        (row) =>
          `${readTextColumn(row, 0, "id")}: ${readTextColumn(row, 1, "reasons")}`,
      )
      .join("; ");
    transaction.onCommit?.(() => {
      logEvent({
        level: "info",
        event: "agent.plan.run_purge.deferred",
        component: "AgentDeferredGarbage",
        message: blocked.length
          ? `Earlier runs retain resources: ${reasons}`
          : "More settled runs remain in the purge batch",
        metadata: {
          runId: keptRunId,
          blockedRunId: blocked[0]?.[0] ?? null,
          reason: blocked[0]?.[1] ?? "batch_remaining",
          count: blocked.length,
        },
      });
      return Promise.resolve();
    });
  });
}

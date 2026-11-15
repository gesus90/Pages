import { readTextColumn } from "@/backend/database/RowValue";
import { AgentRunFailureRepository } from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";
import { indexRunFailures } from "@/backend/service/agents/diagnosis/AgentRunFailureIndexer";

import {
  PLAN_RUN_PURGE_BATCH_SIZE,
  SETTLED_PLAN_RUN,
} from "./AgentPlanRunRetention";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** Prefix of the purge intent a genuinely new run leaves in `agent_payload_garbage`. */
export const PLAN_RUN_PURGE_PREFIX = "plan-runs/";

/** The database a purge needs: plain reads and one transaction per earlier run. */
export type PlanRunPurgeDatabase = Pick<Database, "transaction" | "query">;

/** Earlier runs include recovery and forced-release records once their resources settle. */
const EARLIER_RUNS = `
  SELECT earlier.id
  FROM agent_plan_runs AS earlier
  INNER JOIN agent_plan_runs AS kept
      ON kept.plan_id = earlier.plan_id
  WHERE kept.id = $kept_run_id
      AND earlier.id <> kept.id
      AND (earlier.started_at, earlier.id) < (kept.started_at, kept.id)
  ORDER BY earlier.started_at, earlier.id
  LIMIT ${PLAN_RUN_PURGE_BATCH_SIZE};
`;

/**
 * Locks a terminal run only after its execution and cleanup have settled.
 */
const SETTLED_RUN = `
  SELECT runs.id
  FROM agent_plan_runs AS runs
  WHERE runs.id = $run_id
      AND ${SETTLED_PLAN_RUN}
  FOR UPDATE;
`;

/** Tables that hold one row set per plan run under `run_id`. */
const RUN_TABLES = [
  "agent_plan_checkpoints",
  "agent_local_session_owners",
  "plan_run_commands",
  "plan_run_api_cleanup",
  "agent_plan_loop_iterations",
  "agent_plan_continuations",
  "agent_plan_repair_attempts",
  "agent_plan_cleanup_failures",
  "agent_workspace_cleanup",
  "agent_plan_work",
  "agent_plan_step_reports",
  "agent_plan_step_progress",
  "agent_plan_agent_todos",
  "agent_plan_swarm_boards",
  "agent_run_failure_index",
  "agent_plan_bridge_grants",
  "agent_run_credentials",
  "pica_mobile_notification_deliveries",
  "pica_mobile_notification_occurrences",
  "pica_mobile_notification_sequences",
  "pica_mobile_notification_events",
] as const;

/** The agent run records of a plan run; their run is gone, so nobody can open them any more. */
const PLAN_RUN_RECORD_TABLES = [
  "page_agent_run_inputs",
  "page_agent_archived_runs",
  "page_agent_run_records",
] as const;

/** The PageAgentCLI journal of one run: attempts with their events, chunks, usage and messages. */
const SESSION_TABLES = [
  "agent_session_events",
  "agent_session_history_chunks",
  "agent_session_turn_usage",
  "agent_session_messages",
] as const;

async function deleteRun(
  transaction: DatabaseTransaction,
  runId: string,
): Promise<void> {
  const parameters = { run_id: runId };
  for (const table of PLAN_RUN_RECORD_TABLES)
    await transaction.execute(
      `DELETE FROM ${table} WHERE plan_run_id = $run_id;`,
      parameters,
    );
  for (const table of RUN_TABLES)
    await transaction.execute(
      `DELETE FROM ${table} WHERE run_id = $run_id;`,
      parameters,
    );
  await transaction.execute(
    `
      DELETE FROM agent_plan_recovery_executions
      WHERE run_id = $run_id
          OR target_run_id = $run_id;
    `,
    parameters,
  );
  for (const table of SESSION_TABLES)
    await transaction.execute(
      `
        DELETE FROM ${table}
        WHERE attempt_id IN (
            SELECT attempt_id
            FROM agent_session_attempts
            WHERE run_id = $run_id
        );
      `,
      parameters,
    );
  await transaction.execute(
    "DELETE FROM agent_session_attempts WHERE run_id = $run_id;",
    parameters,
  );
  // The triggers of the run row queue its payload files, its transcript homes
  // and its runner history packets for removal after the commit.
  await transaction.execute(
    "DELETE FROM agent_plan_runs WHERE id = $run_id;",
    parameters,
  );
}

/** Removes one earlier run in a transaction of its own; an unsettled run stays for a later attempt. */
async function purgeRun(
  database: PlanRunPurgeDatabase,
  runId: string,
): Promise<boolean> {
  // Protected runs need no failure-index writes; the transaction still rechecks before deletion.
  const [candidate] = await database.query(
    SETTLED_RUN.replace("FOR UPDATE", ""),
    { run_id: runId },
  );
  if (!candidate) return false;
  // The failures of the run stay countable after it is gone (PAGE-307).
  await indexRunFailures(new AgentRunFailureRepository(database), runId);
  return database.transaction(async (transaction) => {
    const [settled] = await transaction.query(SETTLED_RUN, {
      run_id: runId,
    });
    if (!settled) return false;
    await deleteRun(transaction, runId);
    return true;
  });
}

async function deleteEarlierRefusals(
  database: PlanRunPurgeDatabase,
  keptRunId: string,
): Promise<void> {
  const parameters = { kept_run_id: keptRunId };
  const [pending] = await database.query(
    `
    SELECT 1
    FROM agent_plan_start_rejections
    WHERE plan_id = (SELECT plan_id FROM agent_plan_runs WHERE id = $kept_run_id)
        AND created_at < (SELECT started_at FROM agent_plan_runs WHERE id = $kept_run_id)
    LIMIT 1;
  `,
    parameters,
  );
  if (!pending) return;
  await database.transaction(async (transaction) => {
    await transaction.execute(
      `
        DELETE FROM agent_plan_start_rejections
        WHERE plan_id = (
                SELECT plan_id FROM agent_plan_runs WHERE id = $kept_run_id
            )
            AND created_at < (
                SELECT started_at FROM agent_plan_runs WHERE id = $kept_run_id
            );
      `,
      { kept_run_id: keptRunId },
    );
  });
}

/**
 * Records, with the start of a genuinely new run, that the earlier runs of its plan go.
 *
 * @param transaction - The transaction that inserts the new run.
 * @param runId - The new run, which stays with everything newer than it.
 *
 * @remarks
 * Only the intent is written here, so the start is neither delayed nor
 * refused by the deletion; the background collector of
 * `agent_payload_garbage` carries it out after the commit and retries it.
 */
export async function queueEarlierRunPurge(
  transaction: DatabaseTransaction,
  runId: string,
): Promise<void> {
  await transaction.execute(
    `
      INSERT INTO agent_payload_garbage (storage_name)
      VALUES ($storage_name)
      ON CONFLICT DO NOTHING;
    `,
    { storage_name: `${PLAN_RUN_PURGE_PREFIX}${runId}` },
  );
}

/**
 * Deletes every earlier run of the kept run's plan with all of its rows.
 *
 * @param database - The database; each run goes in a transaction of its own.
 * @param keptRunId - The genuinely new run whose start asked for the purge.
 * @returns Whether no earlier run is left; `false` while a batch or protected run remains.
 *
 * @remarks
 * Runs of other plans and the kept run stay. Refused starts of the plan
 * before the kept run go as well. A run that still holds
 * a lease, a writer lock, a pending cleanup, an unreleased local owner or an
 * accepted command stays until that settled, and a repeated purge finishes it.
 * Recovery and forced-release records follow the same retention rule.
 */
export async function purgeEarlierPlanRuns(
  database: PlanRunPurgeDatabase,
  keptRunId: string,
): Promise<boolean> {
  const earlier = await database.query(EARLIER_RUNS, {
    kept_run_id: keptRunId,
  });
  let isComplete = earlier.length < PLAN_RUN_PURGE_BATCH_SIZE;
  for (const row of earlier)
    if (!(await purgeRun(database, readTextColumn(row, 0, "id"))))
      isComplete = false;
  await deleteEarlierRefusals(database, keptRunId);
  return isComplete;
}

/**
 * Deletes every run of a plan with all of its rows, for a one-time plan that goes (PAGE-309).
 *
 * @param database - The database; each run goes in a transaction of its own.
 * @param planId - The plan whose runs go.
 * @returns Whether no run is left; `false` while one has not settled.
 *
 * @remarks
 * The rows of a run are what Pages remembers about the files and
 * reservations it made for it: its triggers queue the transcript homes, local
 * session journals and payload files for removal after the commit, and a run
 * that still holds a lease, a writer lock, a pending cleanup or an unreleased
 * local owner stays until that settled. A repeated call finishes it.
 */
export async function purgeAllPlanRuns(
  database: PlanRunPurgeDatabase,
  planId: string,
): Promise<boolean> {
  const runs = await database.query(
    `
      SELECT id
      FROM agent_plan_runs
      WHERE plan_id = $plan_id
      ORDER BY creation_order, id;
    `,
    { plan_id: planId },
  );
  let isComplete = true;
  for (const row of runs)
    if (!(await purgeRun(database, readTextColumn(row, 0, "id"))))
      isComplete = false;
  return isComplete;
}

/**
 * Purges one bounded batch of settled orphaned or superseded runs, without a new start.
 *
 * @remarks
 * The newest run is determined by started_at, with id breaking ties. Protected
 * runs are excluded before the limit so they cannot starve the backlog. Every
 * candidate is checked again under its row lock by the common purge path.
 */
export async function purgeObsoletePlanRuns(
  database: PlanRunPurgeDatabase,
): Promise<void> {
  const runs = await database.query(`
    SELECT runs.id
    FROM agent_plan_runs AS runs
    WHERE ${SETTLED_PLAN_RUN}
        AND (
            NOT EXISTS (
                SELECT 1 FROM agent_plans WHERE id = runs.plan_id
            )
            OR EXISTS (
                SELECT 1
                FROM agent_plan_runs AS newer
                WHERE newer.plan_id = runs.plan_id
                    AND (newer.started_at, newer.id) > (runs.started_at, runs.id)
            )
        )
    ORDER BY runs.started_at, runs.id
    LIMIT ${PLAN_RUN_PURGE_BATCH_SIZE};
  `);
  for (const row of runs)
    await purgeRun(database, readTextColumn(row, 0, "id"));
}

import { readTextColumn } from "@/backend/database/RowValue";
import { AgentRunFailureRepository } from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";
import { indexRunFailures } from "@/backend/service/agents/diagnosis/AgentRunFailureIndexer";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** Prefix of the purge intent a genuinely new run leaves in `agent_payload_garbage`. */
export const PLAN_RUN_PURGE_PREFIX = "plan-runs/";

/** The database a purge needs: plain reads and one transaction per earlier run. */
export type PlanRunPurgeDatabase = Pick<Database, "transaction" | "query">;

/** Earlier runs of the kept run's plan; recoveries of the kept run are newer and stay. */
const EARLIER_RUNS = `
  SELECT earlier.id
  FROM agent_plan_runs AS earlier
  INNER JOIN agent_plan_runs AS kept
      ON kept.plan_id = earlier.plan_id
  WHERE kept.id = $kept_run_id
      AND earlier.id <> kept.id
      AND (earlier.view_json::jsonb -> 'resourceReleases') IS NULL
      AND (
          earlier.creation_order IS NULL
          OR earlier.creation_order < kept.creation_order
      )
  ORDER BY earlier.creation_order, earlier.id;
`;

/**
 * A run whose execution or cleanup has not settled yet; its rows still prove
 * an owner, a lease or a reservation and wait for the next attempt.
 */
const SETTLED_RUN = `
  SELECT runs.id
  FROM agent_plan_runs AS runs
  WHERE runs.id = $run_id
      AND (NOT $preserve_released OR (runs.view_json::jsonb -> 'resourceReleases') IS NULL)
      AND runs.status NOT IN ('running', 'pausing', 'paused', 'stopping')
      AND NOT EXISTS (
          SELECT 1 FROM acp_resource_leases WHERE run_id = runs.id
      )
      AND NOT EXISTS (
          SELECT 1 FROM agent_plan_workspace_locks WHERE run_id = runs.id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM agent_workspace_cleanup
          WHERE run_id = runs.id
              AND state = 'pending'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM agent_local_session_owners
          WHERE run_id = runs.id
              AND released_at IS NULL
      )
      AND NOT EXISTS (
          SELECT 1 FROM plan_run_api_cleanup WHERE run_id = runs.id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM plan_run_commands
          WHERE run_id = runs.id
              AND status = 'accepted'
      )
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
  preserveReleased = true,
): Promise<boolean> {
  // The failures of the run stay countable after it is gone (PAGE-307).
  await indexRunFailures(new AgentRunFailureRepository(database), runId);
  return database.transaction(async (transaction) => {
    const [settled] = await transaction.query(SETTLED_RUN, {
      run_id: runId,
      preserve_released: preserveReleased,
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
 * @returns Whether no earlier run is left; `false` while one has not settled.
 *
 * @remarks
 * Runs of other plans, the kept run and its own recoveries stay. Stopping,
 * pausing, resuming, recovering and repairing never call this, so a run keeps
 * its logs, tables and transcripts until its plan starts a new run. Refused
 * starts of the plan before the kept run go as well. A run that still holds
 * a lease, a writer lock, a pending cleanup, an unreleased local owner or an
 * accepted command stays until that settled, and a repeated purge finishes it.
 * Runs with a forced-release journal stay as evidence until explicit plan deletion.
 */
export async function purgeEarlierPlanRuns(
  database: PlanRunPurgeDatabase,
  keptRunId: string,
): Promise<boolean> {
  const earlier = await database.query(EARLIER_RUNS, {
    kept_run_id: keptRunId,
  });
  let isComplete = true;
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
    if (!(await purgeRun(database, readTextColumn(row, 0, "id"), false)))
      isComplete = false;
  return isComplete;
}

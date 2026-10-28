import { ProjectRunsActiveError } from "@/backend/error/ProjectErrors";
import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentRunRecordKey } from "./ProjectDeletionFiles";

/** Runs of the project, including any run of one of its plans started under another project. */
const PLAN_RUNS = `
  SELECT id
  FROM agent_plan_runs
  WHERE project_id = $project_id
      OR plan_id IN (SELECT id FROM agent_plans WHERE project_id = $project_id)
`;
const WORKSPACES =
  "SELECT id FROM agent_workspaces WHERE project_id = $project_id";
const IMPORT_RUNS =
  "SELECT id FROM agent_import_runs WHERE project_id = $project_id";

/** Tables with one row set per plan run. */
const PLAN_RUN_OWNED_TABLES = [
  "page_agent_run_inputs",
  "page_agent_archived_runs",
  "page_agent_run_records",
] as const;

/** Deletes the PageAgentCLI attempts of the plan runs with their events, usage and instructions. */
async function deleteSessionJournal(
  database: DatabaseTransaction,
  parameters: { project_id: string },
): Promise<void> {
  for (const table of [
    "agent_session_events",
    "agent_session_history_chunks",
    "agent_session_turn_usage",
    "agent_session_messages",
  ] as const)
    await database.execute(
      `
        DELETE FROM ${table}
        WHERE attempt_id IN (
            SELECT attempt_id
            FROM agent_session_attempts
            WHERE run_id IN (${PLAN_RUNS})
        );
      `,
      parameters,
    );
  await database.execute(
    `DELETE FROM agent_session_attempts WHERE run_id IN (${PLAN_RUNS});`,
    parameters,
  );
}

/**
 * Deletes the execution plans of a project with their runs, workspaces and imports.
 *
 * @param database - The transaction to delete in.
 * @param projectId - The project whose agent data goes.
 * @returns The records of the plan runs that are gone; their markdown files
 * lie outside the database and are removed by the caller after the commit.
 *
 * @remarks
 * The agents, people and groups that plans refer to are shared objects and
 * stay. A workspace only registers a local directory, so the directory
 * itself is never touched.
 */
export async function deleteProjectAgentData(
  database: DatabaseTransaction,
  projectId: string,
): Promise<AgentRunRecordKey[]> {
  const parameters = { project_id: projectId };
  const [lease] = await database.query(
    `
    SELECT instance_id
    FROM acp_resource_leases
    WHERE run_id IN (${PLAN_RUNS})
    LIMIT 1;
  `,
    parameters,
  );
  if (lease) throw new ProjectRunsActiveError();
  // Lease removal belongs to the scheduler's confirmed closeout.
  await database.execute(
    `DELETE FROM acp_resource_leases WHERE run_id IN (${PLAN_RUNS});`,
    parameters,
  );
  const records = await database.query(
    `
      SELECT
          agent_id,
          run_id
      FROM page_agent_run_records
      WHERE plan_run_id IN (${PLAN_RUNS})
      ORDER BY agent_id, run_id;
    `,
    parameters,
  );

  for (const table of PLAN_RUN_OWNED_TABLES) {
    await database.execute(
      `DELETE FROM ${table} WHERE plan_run_id IN (${PLAN_RUNS});`,
      parameters,
    );
  }
  for (const table of [
    "agent_plan_checkpoints",
    "agent_plan_loop_iterations",
    "agent_plan_continuations",
    "agent_plan_repair_attempts",
    "agent_plan_recovery_executions",
    "agent_plan_work",
  ] as const)
    await database.execute(
      `DELETE FROM ${table} WHERE run_id IN (${PLAN_RUNS});`,
      parameters,
    );
  await deleteSessionJournal(database, parameters);
  await database.execute(
    `DELETE FROM agent_run_credentials WHERE run_id IN (${PLAN_RUNS});`,
    parameters,
  );
  await database.execute(
    `
      DELETE FROM agent_plan_workspace_locks
      WHERE run_id IN (${PLAN_RUNS})
          OR workspace_id IN (${WORKSPACES});
    `,
    parameters,
  );
  await database.execute(
    `DELETE FROM agent_plan_runs WHERE id IN (${PLAN_RUNS});`,
    parameters,
  );
  await database.execute(
    "DELETE FROM agent_plans WHERE project_id = $project_id;",
    parameters,
  );
  // Templates shared in the project go with it; personal ones belong to no project.
  await database.execute(
    "DELETE FROM agent_plan_templates WHERE project_id = $project_id;",
    parameters,
  );
  await database.execute(
    "DELETE FROM agent_workspaces WHERE project_id = $project_id;",
    parameters,
  );
  // Remote profiles go with their project; the remote directories stay untouched.
  await database.execute(
    "DELETE FROM remote_workspaces WHERE project_id = $project_id;",
    parameters,
  );
  await database.execute(
    `DELETE FROM agent_import_items WHERE run_id IN (${IMPORT_RUNS});`,
    parameters,
  );
  await database.execute(
    "DELETE FROM agent_import_runs WHERE project_id = $project_id;",
    parameters,
  );
  await database.execute(
    "DELETE FROM agent_import_sources WHERE project_id = $project_id;",
    parameters,
  );

  return records.map((row) => ({
    agentId: readTextColumn(row, 0, "agent_id"),
    runId: readTextColumn(row, 1, "run_id"),
  }));
}

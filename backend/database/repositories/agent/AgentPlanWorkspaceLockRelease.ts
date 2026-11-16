import { isDeepStrictEqual } from "node:util";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { logEvent } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Rechecks durable obligations under the run fence and logs each committed lock release. */
export async function releaseCheckedWorkspaceLocks(
  transaction: DatabaseTransaction,
  run: AgentPlanRun,
  reason: string,
): Promise<void> {
  const [current] = await transaction.query(
    "SELECT view_json FROM agent_plan_runs WHERE id = $run_id FOR UPDATE;",
    { run_id: run.id },
  );
  if (!current || isActivePlanRun(run.status))
    throw new AgentPlanRecoveryError("action_unavailable");
  const stored = readPlanRun(
    JSON.parse(readTextColumn(current, 0, "view_json")),
  );
  // Display projections such as manualInputAt do not change stored execution ownership.
  if (!isDeepStrictEqual(stored, readPlanRun(run)))
    throw new AgentPlanRecoveryError("revision_conflict");
  const [pending] = await transaction.query(
    `
    SELECT 1
    WHERE EXISTS (SELECT 1 FROM acp_resource_leases WHERE run_id = $run_id)
        OR EXISTS (
            SELECT 1 FROM agent_local_session_owners
            WHERE run_id = $run_id AND released_at IS NULL
        )
        OR EXISTS (
            SELECT 1 FROM agent_workspace_cleanup
            WHERE run_id = $run_id AND state <> 'completed'
        )
        OR EXISTS (SELECT 1 FROM plan_run_api_cleanup WHERE run_id = $run_id)
        OR EXISTS (
            SELECT 1 FROM plan_run_commands
            WHERE run_id = $run_id AND status = 'accepted'
        );
  `,
    { run_id: run.id },
  );
  if (pending) throw new AgentPlanRecoveryError("cleanup_unconfirmed");
  // A runner job without confirmed closeout still owns work outside the database.
  if (stored.runnerJobs?.some((job) => job.closeout !== "confirmed"))
    throw new AgentPlanRecoveryError("cleanup_unconfirmed");
  const released = await transaction.query(
    `
    DELETE FROM agent_plan_workspace_locks
    WHERE run_id = $run_id
    RETURNING workspace_id;
  `,
    { run_id: run.id },
  );
  transaction.onCommit?.(() => {
    for (const row of released)
      logEvent({
        level: "info",
        event: "agent.plan.workspace_lock.released",
        component: "AgentPlanWorkspaceLocks",
        message: "Released a workspace reservation after resource closeout",
        metadata: {
          runId: run.id,
          lock: readTextColumn(row, 0, "workspace_id"),
          reason,
        },
      });
    return Promise.resolve();
  });
}

import { AgentError } from "@/backend/error/AgentErrors";

import type { DatabaseTransaction } from "@/backend/database/Database";

/**
 * Finds one run of a plan that still holds a native owner or a writer lock.
 *
 * @remarks
 * Deleting a plan queues its private payload directory, which holds the
 * snapshots of all of its runs. A run that still owns a local session or a
 * workspace lock is not settled: the start conflict check and the release
 * read its snapshot later, so its plan must stay until it is released.
 */
const HELD_RUN = `
  SELECT runs.id
  FROM agent_plan_runs AS runs
  WHERE runs.plan_id = $plan_id
      AND (
          EXISTS (
              SELECT 1
              FROM agent_local_session_owners AS owners
              WHERE owners.run_id = runs.id
                  AND owners.released_at IS NULL
          )
          OR EXISTS (
              SELECT 1
              FROM agent_plan_workspace_locks AS locks
              WHERE locks.run_id = runs.id
          )
      )
  LIMIT 1;
`;

/**
 * Refuses the deletion of a plan while one of its runs holds resources.
 *
 * @param transaction - The transaction that deletes the plan.
 * @param planId - The plan to delete.
 * @throws {AgentError} `plan_resources_held` while a run of the plan has an
 * unreleased local session owner or a workspace lock.
 */
export async function requireReleasedPlanResources(
  transaction: Pick<DatabaseTransaction, "query">,
  planId: string,
): Promise<void> {
  const [held] = await transaction.query(HELD_RUN, { plan_id: planId });
  if (held) throw new AgentError("plan_resources_held");
}

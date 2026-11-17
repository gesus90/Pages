import { readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  expandedPlanWriteResources,
  planWriterResourcesCollide,
} from "@/backend/service/agents/AgentPlanWriterResources";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** What hands the writing resources of a calling run to the run it called. */
export interface PlanLockHandover {
  readonly invocationId: string;
  readonly sourceRunId: string;
  readonly targetRunId: string;
  /** The writing resources the target run needs. */
  readonly targetKeys: readonly string[];
}

function isActiveStatus(status: unknown): boolean {
  return (
    typeof status === "string" &&
    isActivePlanRun(status as AgentPlanRun["status"])
  );
}

/**
 * Moves the reservations of the calling run that overlap the resources of the called run to the called run.
 * @returns The reservations that changed hands, so they can be returned.
 * @throws {AgentError} `plan_jump_handover_unavailable` when the call is no
 * shared call, was handed over before, or the calling run is no longer active.
 * @remarks
 * Runs in the transaction that creates the called run, so the call, the run
 * and the new owner are stored together; no other run can reserve the
 * resources in between. Only a reservation of the calling run itself changes
 * owner: a resource another run holds stays where it is, and the called run
 * waits for it like any run.
 */
export async function handOverPlanLocks(
  transaction: DatabaseTransaction,
  handover: PlanLockHandover,
): Promise<readonly string[]> {
  const [call] = await transaction.query(
    `
    SELECT
        handover_state,
        workspace_mode
    FROM agent_plan_invocations
    WHERE id = $id
        AND source_run_id = $source_run_id
        AND target_run_id = $target_run_id
    FOR UPDATE;
  `,
    {
      id: handover.invocationId,
      source_run_id: handover.sourceRunId,
      target_run_id: handover.targetRunId,
    },
  );
  const [source] = await transaction.query(
    "SELECT status FROM agent_plan_runs WHERE id = $id FOR UPDATE;",
    { id: handover.sourceRunId },
  );
  if (
    !call ||
    call[0] !== "none" ||
    call[1] !== "shared" ||
    !source ||
    !isActiveStatus(source[0])
  )
    throw new AgentError("plan_jump_handover_unavailable");
  const keys = await expandedPlanWriteResources(handover.targetKeys);
  const held = await transaction.query(
    "SELECT workspace_id FROM agent_plan_workspace_locks WHERE run_id = $run_id;",
    { run_id: handover.sourceRunId },
  );
  const moved = held
    .map((row) => readTextColumn(row, 0, "workspace_id"))
    .filter((resource) =>
      keys.some((key) => planWriterResourcesCollide(resource, key)),
    );
  for (const resource of moved)
    await transaction.execute(
      `
      UPDATE agent_plan_workspace_locks
      SET run_id = $target_run_id
      WHERE workspace_id = $workspace_id
          AND run_id = $source_run_id;
    `,
      {
        target_run_id: handover.targetRunId,
        source_run_id: handover.sourceRunId,
        workspace_id: resource,
      },
    );
  await transaction.execute(
    `
    UPDATE agent_plan_invocations
    SET handover_state = 'handed_over',
        handover_keys_json = $keys
    WHERE id = $id;
  `,
    { id: handover.invocationId, keys: JSON.stringify(moved) },
  );
  return moved;
}

/**
 * Gives the reservations a called run took over back to the run that called it.
 * @param transaction - The transaction that releases the called run's reservations.
 * @param targetRunId - The called run whose reservations are being released.
 * @remarks
 * It runs inside the release itself, after the called run's cleanup was
 * confirmed, so the resources never lie free between the two owners. A
 * calling run that has ended does not get them back; they go away with the
 * release like any other reservation of the called run.
 */
export async function returnHandedOverPlanLocks(
  transaction: DatabaseTransaction,
  targetRunId: string,
): Promise<void> {
  const calls = await transaction.query(
    `
    SELECT
        id,
        source_run_id,
        handover_keys_json
    FROM agent_plan_invocations
    WHERE target_run_id = $run_id
        AND handover_state = 'handed_over'
    FOR UPDATE;
  `,
    { run_id: targetRunId },
  );
  for (const call of calls) {
    const sourceRunId = readTextColumn(call, 1, "source_run_id");
    const [source] = await transaction.query(
      "SELECT status FROM agent_plan_runs WHERE id = $id FOR UPDATE;",
      { id: sourceRunId },
    );
    if (source && isActiveStatus(source[0])) {
      const keys: unknown = JSON.parse(
        readTextColumn(call, 2, "handover_keys_json"),
      );
      for (const key of Array.isArray(keys) ? keys : [])
        if (typeof key === "string")
          await transaction.execute(
            `
            UPDATE agent_plan_workspace_locks
            SET run_id = $source_run_id
            WHERE workspace_id = $workspace_id
                AND run_id = $target_run_id;
          `,
            {
              source_run_id: sourceRunId,
              target_run_id: targetRunId,
              workspace_id: key,
            },
          );
    }
    await transaction.execute(
      `
      UPDATE agent_plan_invocations
      SET handover_state = 'returned'
      WHERE id = $id;
    `,
      { id: readTextColumn(call, 0, "id") },
    );
  }
}

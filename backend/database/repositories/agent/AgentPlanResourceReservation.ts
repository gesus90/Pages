import {
  expandedPlanWriteResources,
  planWriterResourcesCollide,
  isConcretePlanWriterResource,
} from "@/backend/service/agents/AgentPlanWriterResources";
import type { AgentPlanWriterWait } from "@/definition/AgentPlanExecution";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { planWritingWorkspaces } from "@/backend/service/agents/AgentPlanContinuation";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

function snapshotResources(input: unknown): readonly string[] {
  return planWritingWorkspaces(readPlanSnapshot(input));
}

/** Reserves all actual writer resources atomically; contention queues work instead of refusing a plan. */
export async function reservePlanResources(
  transaction: DatabaseTransaction,
  runId: string,
  resourceKeys: readonly string[],
): Promise<boolean> {
  const keys = await expandedPlanWriteResources(resourceKeys);
  const locks = await transaction.query(
    `
    SELECT locks.workspace_id, runs.snapshot_json
    FROM agent_plan_workspace_locks AS locks
    LEFT JOIN agent_plan_runs AS runs ON runs.id = locks.run_id
    WHERE locks.run_id <> $run_id;
  `,
    { run_id: runId },
  );
  for (const lock of locks)
    if (
      await conflictingResource(
        readTextColumn(lock, 0, "workspace_id"),
        lock[1],
        keys,
      )
    )
      return false;
  for (const key of keys)
    await transaction.execute(
      `
    INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
    VALUES ($key, $run_id)
    ON CONFLICT (workspace_id) DO NOTHING;
  `,
      { key, run_id: runId },
    );
  return true;
}

/** A fresh-start transaction retires only its own predecessor and keeps all cleanup reservations. */
export async function retireRestartSource(
  transaction: DatabaseTransaction,
  run: AgentPlanRun,
): Promise<void> {
  if (run.origin?.kind !== "restart") return;
  const [row] = await transaction.query(
    "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
    { id: run.origin.runId },
  );
  if (!row) throw new AgentError("plan_run_unavailable");
  const previous = readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json")));
  if (previous.planId !== run.planId || previous.userId !== run.userId)
    throw new AgentError("plan_access_denied");
  await transaction.execute(
    `
    INSERT INTO agent_workspace_cleanup (workspace_id, run_id, owner_id, removed_by, workspace_name)
    VALUES ($workspace_id, $run_id, $owner_id, $removed_by, $name)
    ON CONFLICT (workspace_id, run_id) DO NOTHING;
  `,
    {
      workspace_id: `reset:${previous.id}`,
      run_id: previous.id,
      owner_id: previous.userId,
      removed_by: run.userId,
      name: previous.planName,
    },
  );
  if (!isActivePlanRun(previous.status)) return;
  const retired: AgentPlanRun = {
    ...previous,
    status: "cancelled",
    stopRequested: true,
    isWaitingForWorkspace: undefined,
    workspaceWait: undefined,
    endedAt: run.startedAt,
    steps: previous.steps.map((step) =>
      ["waiting", "paused"].includes(step.status)
        ? { ...step, status: "cancelled", cancellation: "not_started" }
        : step,
    ),
  };
  await transaction.execute(
    `
    UPDATE agent_plan_runs
    SET status = $status, view_json = $view_json
    WHERE id = $id;
  `,
    {
      id: previous.id,
      status: retired.status,
      view_json: JSON.stringify(retired),
    },
  );
}

/** Returns a concrete held resource; unrelated legacy reservations never block this plan. */
export async function findPlanResourceBlocker(
  transaction: DatabaseTransaction,
  run: AgentPlanRun,
  resourceKeys: readonly string[],
): Promise<AgentPlanWriterWait | null> {
  const keys = await expandedPlanWriteResources(resourceKeys);
  const rows = await transaction.query(
    `
    SELECT locks.workspace_id, runs.view_json, runs.snapshot_json
    FROM agent_plan_workspace_locks AS locks
    LEFT JOIN agent_plan_runs AS runs ON runs.id = locks.run_id
    WHERE locks.run_id <> $run_id;
  `,
    { run_id: run.id },
  );
  for (const row of rows) {
    const stored = readTextColumn(row, 0, "workspace_id");
    const resource = await conflictingResource(stored, row[2], keys);
    if (!resource) continue;
    if (typeof row[1] !== "string")
      return {
        resource,
        reason: "owner_evidence_unavailable",
        runId: null,
        jobId: null,
        attemptId: null,
      };
    const owner = readPlanRun(JSON.parse(row[1]));
    return ownerBlocker(owner, run.userId, resource);
  }
  return keys.length
    ? {
        resource: keys.join(", ").slice(0, 4096),
        reason: "legacy_owner_cleanup_required",
        runId: null,
        jobId: null,
        attemptId: null,
      }
    : null;
}

async function conflictingResource(
  stored: string,
  snapshot: unknown,
  keys: readonly string[],
): Promise<string | undefined> {
  if (isConcretePlanWriterResource(stored))
    return keys.find((key) => planWriterResourcesCollide(stored, key));
  if (typeof snapshot !== "string")
    throw new Error("Legacy writer snapshot missing");
  const previous = await expandedPlanWriteResources(
    snapshotResources(JSON.parse(snapshot)),
  );
  return previous.find((held) =>
    keys.some((key) => planWriterResourcesCollide(held, key)),
  );
}

function ownerBlocker(
  owner: AgentPlanRun,
  userId: string,
  resource: string,
): AgentPlanWriterWait {
  const step = owner.steps.find(
    (entry) =>
      entry.remote?.closeout === "failed" ||
      entry.remote?.closeout === "pending",
  );
  const isOwn = owner.userId === userId;
  return {
    resource,
    reason:
      step?.remote?.cancellation?.failure ??
      (isActivePlanRun(owner.status)
        ? "writer_reserved"
        : "process_end_unconfirmed"),
    runId: isOwn ? owner.id : null,
    jobId: isOwn ? (step?.remote?.jobId ?? null) : null,
    attemptId: isOwn ? (step?.execution?.attemptId ?? null) : null,
  };
}

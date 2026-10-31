import { withReadScope } from "@/backend/database/ReadScope";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanService } from "./AgentPlanService";

/** Recognizes bounded domain refusals; unexpected storage/server failures still propagate. */
export function isPlanHistoryReadFailure(error: unknown): boolean {
  return error instanceof AgentError || error instanceof AgentExecutionError;
}

/** Keeps the existing run response contract without disclosing historical content. */
function controlOnlyRun(run: AgentPlanRun): AgentPlanRun {
  return {
    id: run.id,
    planId: run.planId,
    planName: run.id,
    planRevision: run.continuation?.planRevision ?? run.planRevision,
    userId: run.userId,
    startedAt: run.startedAt,
    status: run.status,
    stopRequested: run.stopRequested,
    steps: [],
  };
}

/** Proves current editable-plan ownership separately from permission to read historical resources. */
export async function readPlanControlRun(
  plans: Pick<AgentPlanService, "controlRun" | "run">,
  userId: string,
  planId: string,
  runId: string,
): Promise<{
  readonly run: AgentPlanRun;
  readonly continuationVersion: number;
  readonly hasHistoryAccess: boolean;
}> {
  const owned = await plans.controlRun(userId, runId);
  if (owned.planId !== planId || owned.userId !== userId || owned.id !== runId)
    throw new AgentError("plan_access_denied");
  const continuationVersion = owned.continuation?.version ?? 0;
  try {
    return {
      run: await plans.run(userId, runId),
      continuationVersion,
      hasHistoryAccess: true,
    };
  } catch (error: unknown) {
    if (!isPlanHistoryReadFailure(error)) throw error;
    // Recheck ownership after the failed read, which may itself reflect revoked plan rights.
    const current = await plans.controlRun(userId, runId);
    if (
      current.planId !== planId ||
      current.userId !== userId ||
      current.id !== runId
    )
      throw new AgentError("plan_access_denied");
    return {
      run: controlOnlyRun(current),
      continuationVersion: current.continuation?.version ?? 0,
      hasHistoryAccess: false,
    };
  }
}

/**
 * Control-only projection keeps Stop and reviewed restart available without denied history.
 *
 * @remarks
 * The control state and the checks of its run are read in one scope, so what
 * both ask for again is answered once.
 */
export async function authorizedPlanControl(
  plans: Pick<AgentPlanService, "controlRun" | "run">,
  userId: string,
  planId: string,
  read: () => Promise<AgentPlanControl>,
): Promise<AgentPlanControl> {
  return withReadScope(async () => {
    const control = await read();
    if (!control.canEdit || !control.runId) return control;
    const access = await readPlanControlRun(
      plans,
      userId,
      planId,
      control.runId,
    );
    if (access.hasHistoryAccess) return control;
    return controlOnlyPlanControl(control, access);
  });
}

/** Shares the same denied-history allowlist between UI polling and the MCP projection. */
export function controlOnlyPlanControl(
  control: AgentPlanControl,
  access: Awaited<ReturnType<typeof readPlanControlRun>>,
): AgentPlanControl {
  return {
    runId: access.run.id,
    status: access.run.status,
    canPlay: control.canRestart === true,
    canRestart: control.canRestart,
    canEdit: control.canEdit,
    canPause: false,
    canResume: false,
    canStop:
      control.canStop &&
      !access.run.stopRequested &&
      isActivePlanRun(access.run.status),
    issue: "plan_access_denied",
    planRevision: access.run.planRevision,
    continuationVersion: access.continuationVersion,
    frontierStepIds: [],
  };
}

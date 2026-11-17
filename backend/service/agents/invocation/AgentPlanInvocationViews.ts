import { isPlanAdministrator } from "@/definition/AgentPlanTeam";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanJumpRun } from "@/definition/AgentPlanJump";
import type { PlanDependencies } from "../AgentPlanDependencies";

type ViewDependencies = Pick<PlanDependencies, "invocations" | "runs" | "access">;

/**
 * Whether the person may read the run now.
 * @remarks
 * A link between two runs is only shown to someone who could open the run it
 * leads to; the run itself is read through the full checks when it is opened.
 */
async function canFollow(
  dependencies: ViewDependencies,
  userId: string,
  runId: string,
): Promise<boolean> {
  try {
    const run = await dependencies.runs.find(runId);
    if (!run) return false;
    const plan = await dependencies.access.require(userId, run.planId);
    return (
      run.userId === userId ||
      isPlanAdministrator(plan) ||
      plan.rights?.canReadAllRuns === true
    );
  } catch {
    return false;
  }
}

/** The step as a client may see it: no value a call handed on or back. */
function publicStep(step: AgentPlanStepResult): AgentPlanStepResult {
  return { ...step, jumpOutputs: undefined, returned: undefined };
}

/** What the call stands at now, read from the register and the called run. */
async function liveJump(
  dependencies: ViewDependencies,
  userId: string,
  jump: AgentPlanJumpRun,
): Promise<AgentPlanJumpRun> {
  const record = await dependencies.invocations?.find(jump.invocationId);
  if (!record) return { ...jump, targetRunId: null };
  const mayFollow =
    record.targetRunId !== null &&
    (await canFollow(dependencies, userId, record.targetRunId));
  const target = mayFollow
    ? await dependencies.runs.find(record.targetRunId ?? "")
    : null;
  return {
    ...jump,
    state: record.state,
    targetRunId: mayFollow ? record.targetRunId : null,
    targetStatus:
      target?.status ?? record.targetStatus ??
      (record.start === "pending" ? "queued" : jump.targetStatus),
    deadlineAt: record.deadlineAt,
    handover: record.handover,
    hasSignal: record.state === "signalled",
    reason: record.failureReason,
  };
}

/**
 * Prepares a run for a reader: the live state of its calls, links only to runs the reader may open, and no
 * value that was handed between plans.
 * @param dependencies - The call register, the run store and the plan access.
 * @param userId - The person who reads.
 * @param run - The run as the reader may see it so far.
 */
export async function withInvocationViews(
  dependencies: ViewDependencies,
  userId: string,
  run: AgentPlanRun,
): Promise<AgentPlanRun> {
  const steps = await Promise.all(
    run.steps.map(async (step) => {
      const visible = publicStep(step);
      return visible.jump
        ? { ...visible, jump: await liveJump(dependencies, userId, visible.jump) }
        : visible;
    }),
  );
  const { invocation } = run;
  const mayFollowSource =
    invocation !== undefined &&
    (await canFollow(dependencies, userId, invocation.sourceRunId));
  return {
    ...run,
    invocation: mayFollowSource ? invocation : undefined,
    steps,
  };
}

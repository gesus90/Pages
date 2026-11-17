import { PLAN_JUMP_PORT } from "@/definition/AgentPlanJump";

import type { AgentPlanInvocationRecord } from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";
import type {
  AgentPlanJumpOut,
  AgentPlanJumpRun,
} from "@/definition/AgentPlanJump";

/** The target status a card shows before and while the called run exists. */
function targetStatus(record: AgentPlanInvocationRecord): string {
  if (record.targetStatus !== null) return record.targetStatus;
  if (record.start === "pending") return "queued";
  return record.targetRunId === null ? "none" : "running";
}

/**
 * The call of an outgoing Jump as its run shows it.
 * @param record - The stored call.
 * @param node - The Jump node of the calling plan.
 * @remarks
 * It carries no value of the call, only where the call stands.
 */
export function jumpRunView(
  record: AgentPlanInvocationRecord,
  node: AgentPlanJumpOut,
): AgentPlanJumpRun {
  return {
    invocationId: record.id,
    targetPlanId: record.targetPlanId,
    targetPlanName: node.target?.planName ?? "",
    entryNodeId: record.entryNodeId,
    wait: record.wait,
    state: record.state,
    targetRunId: record.targetRunId,
    targetStatus: targetStatus(record),
    deadlineAt: record.deadlineAt,
    handover: record.handover,
    hasSignal: record.state === "signalled",
    reason: record.failureReason,
  };
}

/** The values a decided call hands on: its run id, its reason and what the outcome carries. */
export function jumpOutputs(
  record: AgentPlanInvocationRecord,
): Readonly<Record<string, AgentParameterValue>> {
  return {
    ...(record.outcome?.values ?? {}),
    [PLAN_JUMP_PORT.runIdOut]: {
      type: "text",
      text: record.targetRunId ?? record.id,
    },
    [PLAN_JUMP_PORT.reasonOut]: {
      type: "text",
      text: record.failureReason ?? "",
    },
  };
}

/**
 * What a failed or timed out call does to the calling node.
 * @remarks
 * A connected output turns the failure into an explicit path: the node
 * succeeds and the run goes on there. An unconnected output lets the node, and
 * with it the run, fail.
 */
function routedFailure(
  plan: Pick<AgentPlanInput, "edges">,
  node: AgentPlanJumpOut,
  failure: {
    readonly port: string;
    readonly branch: AgentPlanBranch;
    readonly code: string;
  },
  base: Partial<AgentPlanStepResult>,
): Partial<AgentPlanStepResult> {
  const isConnected = plan.edges.some(
    (edge) => edge.from === node.id && edge.fromPort === failure.port,
  );
  if (isConnected)
    return {
      ...base,
      status: "succeeded",
      output: null,
      error: null,
      branch: failure.branch,
    };
  return { ...base, status: "failed", error: failure.code };
}

/**
 * The result of an outgoing Jump once its call is decided.
 * @param record - The decided call.
 * @param node - The Jump node.
 * @param plan - The frozen plan, which tells whether the failure outputs are connected.
 */
export function jumpOutcome(
  record: AgentPlanInvocationRecord,
  node: AgentPlanJumpOut,
  plan: Pick<AgentPlanInput, "edges">,
): Partial<AgentPlanStepResult> {
  const base: Partial<AgentPlanStepResult> = {
    jump: jumpRunView(record, node),
    jumpOutputs: jumpOutputs(record),
  };
  if (record.state === "timed_out")
    return routedFailure(
      plan,
      node,
      {
        port: PLAN_JUMP_PORT.timeoutOut,
        branch: "timeout",
        code: record.failureReason ?? "plan_jump_timeout",
      },
      base,
    );
  if (record.state === "failed")
    return routedFailure(
      plan,
      node,
      {
        port: PLAN_JUMP_PORT.errorOut,
        branch: "error",
        code: record.failureReason ?? "plan_jump_target_failed",
      },
      base,
    );
  if (record.state === "cancelled")
    return { ...base, status: "cancelled", cancellation: "requested" };
  // The normal exit: the branch is cleared, so an earlier start's failure output stays unused.
  return {
    ...base,
    status: "succeeded",
    output: null,
    error: null,
    branch: undefined,
  };
}

/** The returned values of a run that ended: the values its reached end handed over. */
export function endValues(
  run: AgentPlanRun,
): Readonly<Record<string, AgentParameterValue>> {
  const end = run.steps.find(
    (step) => step.status === "succeeded" && step.returned !== undefined,
  );
  return end?.returned ?? {};
}

/**
 * The result of a Jump whose call failed before it could be stored or started.
 * @param plan - The frozen plan.
 * @param node - The Jump node.
 * @param code - The failure code.
 */
export function jumpFailure(
  plan: Pick<AgentPlanInput, "edges">,
  node: AgentPlanJumpOut,
  code: string,
): Partial<AgentPlanStepResult> {
  return routedFailure(
    plan,
    node,
    { port: PLAN_JUMP_PORT.errorOut, branch: "error", code },
    {
      jumpOutputs: {
        [PLAN_JUMP_PORT.runIdOut]: { type: "text", text: "" },
        [PLAN_JUMP_PORT.reasonOut]: { type: "text", text: code },
      },
    },
  );
}

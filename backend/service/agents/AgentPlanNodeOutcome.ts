import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { dispatchRemoteStepWithRetry } from "./AgentPlanRemoteRetry";
import {
  dispatchPlanLocalNode,
  dispatchPlanLoop,
} from "./AgentPlanNodeDispatch";
import { eventStart } from "./branching/AgentPlanBranchSettle";
import {
  guardPlanWorkDispatch,
  settlePlanWorkResult,
} from "./AgentPlanWorkDispatch";

import type { RemotePlanStep } from "./AgentPlanRemoteExecution";
import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { PlanInstructionWork } from "./AgentPlanInstructionControl";

interface NodeOutcomeInput {
  readonly dependencies: EngineDependencies;
  readonly nodes: Parameters<typeof dispatchPlanLoop>[3];
  readonly instruction: (work: PlanInstructionWork) => Promise<PlanSessionTurn>;
  readonly saveSession: (session: AgentPlanSessionRecord) => Promise<void>;
}

/** Dispatches new nodes or reattaches already dispatched native work through the same engine gates. */
export async function planNodeOutcome(
  active: ActivePlanRun,
  node: AgentPlanNode,
  controller: AbortController,
  input: NodeOutcomeInput,
): Promise<Partial<AgentPlanStepResult>> {
  const isReattaching = isReattachingLocalNode(
    active,
    node.id,
    input.dependencies.localSessions,
  );
  const isRestoredLoop =
    node.type === "loop" &&
    Boolean(input.dependencies.localSessions?.hasRun(active.view.id));
  const restoredRemote = restoredRemoteStep(active, node.id);
  if (needsDispatchAuthorization(isReattaching, isRestoredLoop, restoredRemote))
    await guardPlanWorkDispatch(input.dependencies.workGate, active, node.id);
  // The gate belongs to each attempt: a failed gate is a repair in the same step, not its end.
  const settle = (
    result: Partial<AgentPlanStepResult>,
  ): Promise<Partial<AgentPlanStepResult>> =>
    settlePlanWorkResult(input.dependencies.workGate, active, node, result);
  if (restoredRemote && input.dependencies.remoteExecution)
    return settle(
      await input.dependencies.remoteExecution.observe(
        active.view,
        restoredRemote,
        controller.signal,
      ),
    );
  const remote = dispatchRemoteStepWithRetry(
    input.dependencies.remoteExecution
      ? {
          service: input.dependencies.remoteExecution,
          runs: input.dependencies.runs,
          settle,
        }
      : undefined,
    active,
    node.id,
    controller.signal,
  );
  if (remote) return remote;
  const local = dispatchPlanLocalNode(active, node, controller, input.nodes);
  if (local) return local;
  const step = active.snapshot.steps.find((entry) => entry.step.id === node.id);
  if (step) {
    if (
      (active.view.stopRequested || controller.signal.aborted) &&
      !isReattaching
    )
      return { status: "cancelled", cancellation: "not_started" };
    return input.dependencies.steps.run(active.view, active.snapshot, step, {
      signal: controller.signal,
      settle,
      ...eventStart(active, node.id),
      awaitDispatch: () => {
        active.dispatched.delete(node.id);
      },
      claimStart: () => {
        claimPlanNodeStart(active, node.id);
      },
      runInstruction: (work) => input.instruction(work),
      save: (session) => input.saveSession(session),
    });
  }
  return controlNodeOutcome(active, node, controller, {
    input,
    isRestoredLoop,
  });
}

function isReattachingLocalNode(
  active: ActivePlanRun,
  nodeId: string,
  local: EngineDependencies["localSessions"],
): boolean {
  const existing = active.view.steps.find((step) => step.id === nodeId);
  return Boolean(existing?.session && local?.has(existing.session.instanceId));
}

function claimPlanNodeStart(active: ActivePlanRun, nodeId: string): void {
  if (active.dispatched.has(nodeId)) return;
  if (active.view.status !== "running") throw new AgentPlanPausedError();
  active.dispatched.add(nodeId);
}

async function controlNodeOutcome(
  active: ActivePlanRun,
  node: AgentPlanNode,
  controller: AbortController,
  options: {
    readonly input: NodeOutcomeInput;
    readonly isRestoredLoop: boolean;
  },
): Promise<Partial<AgentPlanStepResult>> {
  const { input, isRestoredLoop } = options;
  try {
    if (node.type === "loop" && isRestoredLoop)
      return await dispatchPlanLoop(active, node, controller, input.nodes);
    if (active.view.stopRequested || controller.signal.aborted)
      throw new AgentPlanCancelledError();
    if (active.view.status !== "running") throw new AgentPlanPausedError();
    active.dispatched.add(node.id);
    if (node.type === "loop")
      return await dispatchPlanLoop(active, node, controller, input.nodes);
    await input.dependencies.start.control(active.view, active.snapshot, node);
    return { status: "succeeded", output: null, error: null };
  } catch (error: unknown) {
    logCaughtError("AgentPlanRunEngine", error);

    if (error instanceof AgentPlanPausedError) return { status: "paused" };
    if (error instanceof AgentPlanCancelledError)
      return { status: "cancelled", cancellation: "not_started" };
    return {
      status: "failed",
      error:
        error instanceof AgentError || error instanceof AgentExecutionError
          ? error.code
          : "plan_step_failed",
    };
  }
}

function restoredRemoteStep(
  active: ActivePlanRun,
  stepId: string,
): RemotePlanStep | undefined {
  const step = active.view.steps.find((entry) => entry.id === stepId);
  return step?.remote
    ? active.snapshot.remoteSteps?.find((entry) => entry.step.id === stepId)
    : undefined;
}

function needsDispatchAuthorization(
  isReattaching: boolean,
  isRestoredLoop: boolean,
  remote: RemotePlanStep | undefined,
): boolean {
  return !isReattaching && !isRestoredLoop && !remote;
}

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import { runPlanStepWithRetry } from "./AgentPlanStepRetry";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { NodeRun, StepRunControl } from "./AgentPlanStepContext";

interface AttemptOperations {
  readonly execute: () => Promise<Partial<AgentPlanStepResult>>;
  readonly failure: (error: unknown) => Promise<Partial<AgentPlanStepResult>>;
  readonly paused: () => Promise<Partial<AgentPlanStepResult>>;
  readonly save: (changes: Partial<AgentPlanSessionRecord>) => Promise<void>;
}

async function attempt(
  node: NodeRun,
  control: StepRunControl,
  operations: AttemptOperations,
): Promise<Partial<AgentPlanStepResult>> {
  node.control = control;
  node.hasStarted = false;
  node.record = null;
  control.awaitDispatch?.();
  try {
    return await operations.execute();
  } catch (error: unknown) {
    if (
      !node.hasStarted &&
      (error instanceof AgentPlanPausedError ||
        control.signal.reason instanceof AgentPlanPausedError)
    )
      return operations.paused();
    return operations.failure(error);
  }
}

/** Keeps retry waits outside attempt timeouts and lets pause/stop cancel a durable wait immediately. */
export async function runPlanNodeAttempts(
  node: NodeRun,
  operations: AttemptOperations,
): Promise<Partial<AgentPlanStepResult>> {
  const control = node.control;
  try {
    return await runPlanStepWithRetry({
      signal: control.signal,
      previous: node.retry,
      isSharedSession: node.sessionGroup !== undefined,
      attempt: () => attempt(node, control, operations),
      waiting: () => {
        node.hasStarted = false;
        node.control = control;
        control.awaitDispatch?.();
      },
      save: async (retry) => {
        node.retry = retry;
        await operations.save({ retry });
        return node.record;
      },
    });
  } catch (error: unknown) {
    if (
      !node.hasStarted &&
      control.signal.reason instanceof AgentPlanPausedError
    )
      return operations.paused();
    if (!control.signal.aborted) return operations.failure(error);
    if (node.retry) {
      node.retry = { ...node.retry, state: "cancelled", nextAttemptAt: null };
      await operations.save({ retry: node.retry });
    }
    return operations.failure(new AgentPlanCancelledError());
  }
}

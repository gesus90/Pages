import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import {
  runPlanStepWithRetry,
  type RetryAttemptContext,
} from "./AgentPlanStepRetry";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { NodeRun, StepRunControl } from "./AgentPlanStepContext";

interface AttemptOperations {
  readonly execute: (
    context: RetryAttemptContext,
  ) => Promise<Partial<AgentPlanStepResult>>;
  readonly failure: (error: unknown) => Promise<Partial<AgentPlanStepResult>>;
  readonly paused: () => Promise<Partial<AgentPlanStepResult>>;
  readonly save: (changes: Partial<AgentPlanSessionRecord>) => Promise<void>;
}

async function attempt(
  node: NodeRun,
  control: StepRunControl,
  operations: AttemptOperations,
  context: RetryAttemptContext,
): Promise<Partial<AgentPlanStepResult>> {
  node.control = control;
  node.hasStarted = false;
  node.retryGroup = null;
  if (node.record?.group)
    node.retryGroup = {
      creatorStepId: node.record.group.creatorStepId,
      turn: node.record.group.turn,
    };
  else if (node.record?.loop)
    node.retryGroup = {
      creatorStepId: node.step.step.id,
      turn: node.record.loop.turn,
    };
  node.record = null;
  node.retryResumeSessionId = context.resumeSessionId;
  node.retryAttemptNumber = context.attemptNumber;
  control.awaitDispatch?.();
  try {
    return await operations.execute(context);
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
      lastSession: () => node.record,
      attempt: (context) => attempt(node, control, operations, context),
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

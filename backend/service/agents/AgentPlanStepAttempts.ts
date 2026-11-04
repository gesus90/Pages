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

/**
 * Puts the record of the earlier attempt back when this one ended without its own.
 *
 * @remarks
 * A start refused before its record has nothing else to show, and the earlier
 * record holds what really ran: its session, its closeout and the retry history.
 * The result stays without a session, so the earlier report does not judge this
 * failure. Only a pause carries it, because it stores what it returns.
 */
function keepEarlierRecord(
  node: NodeRun,
  earlier: AgentPlanSessionRecord | null,
  result: Partial<AgentPlanStepResult>,
): Partial<AgentPlanStepResult> {
  if (node.record !== null || earlier === null) return result;
  node.record = earlier;
  return result.status === "paused" ? { ...result, session: earlier } : result;
}

/** One attempt: its execution and the verdict of the gate, or what its failure leaves. */
async function settledAttempt(
  node: NodeRun,
  control: StepRunControl,
  operations: AttemptOperations,
  context: RetryAttemptContext,
): Promise<Partial<AgentPlanStepResult>> {
  try {
    const result = await operations.execute(context);
    return control.settle ? await control.settle(result) : result;
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
  else if (node.record?.event)
    node.retryGroup = {
      creatorStepId: node.step.step.id,
      turn: node.record.event.turn,
    };
  const earlier = node.record;
  node.record = null;
  node.retryResumeSessionId = context.resumeSessionId;
  node.retryAttemptNumber = context.attemptNumber;
  control.awaitDispatch?.();
  return keepEarlierRecord(
    node,
    earlier,
    await settledAttempt(node, control, operations, context),
  );
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
      // The session of an agent with an event input is its own: a retry replaces it as a recovered start, which carries everything again.
      isSharedSession: node.sessionGroup !== undefined && !node.receivesEvents,
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

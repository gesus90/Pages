import { setTimeout as wait } from "node:timers/promises";

import {
  decidePlanRetryContinuation,
  decidePlanStepRetry,
} from "./AgentPlanStepDecision";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  PlanRetryWork,
  RetryAttemptContext,
} from "./AgentPlanStepDecision";

export type { RetryAttemptContext } from "./AgentPlanStepDecision";

const RESET_GRACE_MILLISECONDS = 60_000;

interface RetryWork extends PlanRetryWork {
  readonly signal: AbortSignal;
  readonly previous: AgentPlanRetry | null;
  readonly attempt: (
    context: RetryAttemptContext,
  ) => Promise<Partial<AgentPlanStepResult>>;
  readonly waiting: () => void;
  readonly save: (
    retry: AgentPlanRetry,
  ) => Promise<AgentPlanSessionRecord | null>;
}

async function waitForRetry(
  retry: AgentPlanRetry,
  work: RetryWork,
): Promise<void> {
  work.waiting();
  work.signal.throwIfAborted();
  const deadline = Date.parse(retry.nextAttemptAt ?? "");
  if (!Number.isFinite(deadline))
    throw new Error("Invalid plan retry deadline");
  while (Date.now() < deadline) {
    await wait(
      Math.min(RESET_GRACE_MILLISECONDS, deadline - Date.now()),
      undefined,
      { signal: work.signal },
    );
  }
  work.signal.throwIfAborted();
}

/** A stored safety block or exhausted budget must never dispatch after recovery. */
function blockedResult(work: RetryWork): Partial<AgentPlanStepResult> | null {
  const retry = work.previous;
  if (retry?.state !== "blocked") return null;
  return {
    status: "failed",
    error: retry.attempts.at(-1)?.code ?? "plan_step_failed",
    isBlocked: true,
    session: work.lastSession(),
  };
}

async function abortedResult(
  retry: AgentPlanRetry | null,
  work: RetryWork,
  result: Partial<AgentPlanStepResult>,
): Promise<Partial<AgentPlanStepResult>> {
  if (!retry) return result;
  const isPaused = result.status === "paused";
  const session = await work.save({
    ...retry,
    state: isPaused ? "waiting" : "cancelled",
    nextAttemptAt: isPaused
      ? (retry.nextAttemptAt ?? new Date().toISOString())
      : null,
  });
  return { ...result, session };
}

function finishedRetry(
  retry: AgentPlanRetry,
  result: Partial<AgentPlanStepResult>,
): Pick<AgentPlanRetry, "state" | "reason"> {
  return result.status === "succeeded"
    ? { state: "completed", reason: retry.reason }
    : { state: "blocked", reason: "failed" };
}

/** Retries one unfinished node after confirmed cleanup, with a persisted deadline and the same frozen routing. */
export async function runPlanStepWithRetry(
  work: RetryWork,
): Promise<Partial<AgentPlanStepResult>> {
  const blocked = blockedResult(work);
  if (blocked) return blocked;
  let retry = work.previous;
  let continuation: RetryAttemptContext = retry
    ? decidePlanRetryContinuation(retry, work.lastSession())
    : {
        attemptNumber: 1,
        resumeSessionId: null,
        isNewSessionAfterFailure: false,
      };
  for (;;) {
    if (retry?.state === "waiting") {
      await waitForRetry(retry, work);
      continuation = decidePlanRetryContinuation(retry, work.lastSession());
      retry = { ...retry, state: "running", nextAttemptAt: null };
      await work.save(retry);
    }
    work.signal.throwIfAborted();
    const result = await work.attempt(continuation);
    // A pause is no failure, also without an abort: the sequence goes on from where it stands after the resume.
    if (work.signal.aborted || result.status === "paused")
      return abortedResult(retry, work, result);
    const next = decidePlanStepRetry(result, work, retry);
    if (next) {
      retry = next;
      // Close dispatch before the persistence await, so a concurrent pause can abort this wait.
      if (retry.state === "waiting") work.waiting();
      const session = await work.save(retry);
      if (retry.state === "blocked")
        return { ...result, isBlocked: true, session };
      continuation = decidePlanRetryContinuation(retry, work.lastSession());
      continue;
    }
    if (!retry) return result;
    const finished = finishedRetry(retry, result);
    const session = await work.save({
      ...retry,
      ...finished,
      nextAttemptAt: null,
    });
    return { ...result, isBlocked: finished.state === "blocked", session };
  }
}

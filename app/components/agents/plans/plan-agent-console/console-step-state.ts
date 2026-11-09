import {
  PLAN_BLOCKER_RETRIES,
  PLAN_INFRASTRUCTURE_RETRY_DELAYS,
} from "@/definition/AgentPlanRetry";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanRetry,
  AgentPlanRetryAttempt,
} from "@/definition/AgentPlanRetry";
import type { AgentSessionState } from "@/definition/AgentSessionJournal";
import type { TerminalEnding } from "./terminal-lines";

/** What the state pill of the header says (PAGE-284). */
export type ConsoleStepState =
  | { readonly kind: "resume"; readonly seconds: number }
  | { readonly kind: "succeeded" }
  | { readonly kind: "blocked" }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "session"; readonly state: AgentSessionState };

/** An earlier attempt of the node whose history the terminal shows before the current one. */
export interface EarlierAttempt {
  readonly attemptId: string;
  readonly number: number;
  readonly endedAt: string;
  readonly ending: TerminalEnding;
}

function secondsUntil(at: string | null, now: number): number {
  const deadline = Date.parse(at ?? "");
  return Number.isFinite(deadline)
    ? Math.max(0, Math.round((deadline - now) / 1000))
    : 0;
}

/** Failed attempts of a class up to and including one index. */
function failedUpTo(
  attempts: readonly AgentPlanRetryAttempt[],
  index: number,
  failureClass: AgentPlanRetryAttempt["failureClass"],
): number {
  return attempts
    .slice(0, index + 1)
    .filter((attempt) => attempt.failureClass === failureClass).length;
}

/**
 * How many automatic restarts after technical failures the node had.
 *
 * @param step - The node in the run.
 * @returns The count of `infrastructure` failures, at most the budget.
 */
export function infrastructureRestarts(step: AgentPlanStepResult): number {
  const attempts = step.session?.retry?.attempts ?? [];
  return Math.min(
    attempts.filter((attempt) => attempt.failureClass === "infrastructure")
      .length,
    PLAN_BLOCKER_RETRIES.infrastructure,
  );
}

/** The ending of a failed attempt that another attempt follows or will follow. */
function abortedEnding(
  retry: AgentPlanRetry,
  index: number,
  facts: {
    readonly delaySeconds?: number;
    readonly nextSessionId: string | null;
  },
): TerminalEnding {
  const attempt = retry.attempts[index];
  const failureClass = attempt?.failureClass ?? "open";
  const restart = failedUpTo(retry.attempts, index, failureClass);
  const limit = PLAN_BLOCKER_RETRIES[failureClass];
  const isRestart = failureClass === "infrastructure";
  const delay = isRestart
    ? PLAN_INFRASTRUCTURE_RETRY_DELAYS[
        Math.min(
          Math.max(restart, 1),
          PLAN_INFRASTRUCTURE_RETRY_DELAYS.length,
        ) - 1
      ] / 1000
    : 0;
  return {
    kind: "aborted",
    reason: attempt?.code ?? "plan_step_failed",
    resume:
      restart > limit
        ? null
        : {
            delaySeconds: facts.delaySeconds ?? delay,
            restart,
            limit,
            isSameSession:
              attempt?.sessionId !== null &&
              attempt?.sessionId === facts.nextSessionId,
            isRepair: !isRestart,
          },
  };
}

/**
 * The earlier attempts of the node, oldest first, with how each ended.
 *
 * @param step - The node in the run.
 * @param currentAttemptId - The attempt of the node's record now.
 */
export function earlierAttempts(
  step: AgentPlanStepResult,
  currentAttemptId: string,
): readonly EarlierAttempt[] {
  const retry = step.session?.retry;
  if (!retry) return [];
  return retry.attempts.flatMap((attempt, index) => {
    if (!attempt.attemptId || attempt.attemptId === currentAttemptId) return [];
    const nextSessionId =
      retry.attempts[index + 1]?.sessionId ?? step.session?.sessionId ?? null;
    return [
      {
        attemptId: attempt.attemptId,
        number: index + 1,
        endedAt: attempt.endedAt,
        ending: abortedEnding(retry, index, { nextSessionId }),
      },
    ];
  });
}

/** How the current attempt ended when the retries of the node recorded it as failed. */
function retryEnding(
  step: AgentPlanStepResult,
  retry: AgentPlanRetry,
  now: number,
): TerminalEnding | null {
  const index = retry.attempts.findIndex(
    (attempt) => attempt.attemptId === step.session?.attemptId,
  );
  if (index < 0) return null;
  if (retry.state === "waiting")
    return abortedEnding(retry, index, {
      delaySeconds: secondsUntil(retry.nextAttemptAt, now),
      nextSessionId: retry.requiredResumeSessionId ?? null,
    });
  if (retry.state === "cancelled") return { kind: "stopped" };
  if (retry.state !== "blocked") return null;
  return {
    kind: "blocked",
    reason: retry.attempts.at(-1)?.code ?? "plan_step_failed",
    attempts: retry.attempts.length,
  };
}

function doneTodos(step: AgentPlanStepResult): {
  readonly done: number;
  readonly total: number;
} {
  const todos = step.session?.acceptance?.todos ?? [];
  return {
    done: todos.filter((todo) => todo.status === "done").length,
    total: todos.length,
  };
}

/**
 * How the current attempt of the node ended, or `null` while it runs.
 *
 * @param step - The node in the run.
 * @param now - The time now, for the countdown of a planned resume.
 */
export function currentEnding(
  step: AgentPlanStepResult,
  now: number,
): TerminalEnding | null {
  const retry = step.session?.retry;
  const ending = retry ? retryEnding(step, retry, now) : null;
  if (ending) return ending;
  if (step.status === "succeeded")
    return { kind: "succeeded", ...doneTodos(step) };
  if (step.status === "cancelled") return { kind: "stopped" };
  if (step.status === "failed")
    return {
      kind: "blocked",
      reason: step.error ?? "plan_step_failed",
      attempts: Math.max(1, retry?.attempts.length ?? 1),
    };
  return null;
}

/**
 * What the state pill of the header says.
 *
 * @param step - The node in the run.
 * @param sessionState - What the session reports, while it runs.
 * @param now - The time now, for the countdown of a planned resume.
 */
export function consoleStepState(
  step: AgentPlanStepResult,
  sessionState: AgentSessionState | null,
  now: number,
): ConsoleStepState | null {
  const retry = step.session?.retry;
  if (retry?.state === "waiting")
    return { kind: "resume", seconds: secondsUntil(retry.nextAttemptAt, now) };
  if (step.status === "succeeded") return { kind: "succeeded" };
  if (step.status === "cancelled") return { kind: "stopped" };
  if (step.status === "failed")
    return step.isBlocked || retry?.state === "blocked"
      ? { kind: "blocked" }
      : { kind: "failed" };
  return sessionState ? { kind: "session", state: sessionState } : null;
}

/**
 * Whether the session of the node ended, so the terminal takes no input any more.
 *
 * @param step - The node in the run.
 */
export function hasSessionEnded(step: AgentPlanStepResult): boolean {
  return ["succeeded", "failed", "cancelled", "skipped"].includes(step.status);
}

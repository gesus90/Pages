import { setTimeout as wait } from "node:timers/promises";

import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import { isPlanSessionRetryCode } from "@/backend/agents/AgentSessionFailure";
import {
  PLAN_MAXIMUM_RETRIES,
  PLAN_SESSION_MAXIMUM_ATTEMPTS,
  PLAN_SESSION_RETRY_DELAY_MILLISECONDS,
} from "@/definition/AgentPlanRetry";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanRetry,
  AgentPlanRetryAttempt,
  AgentPlanRetryPolicy,
} from "@/definition/AgentPlanRetry";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Growing waits before each of the ten provider retries; remote reconnects follow the same scheme. */
export const PLAN_RETRY_DELAYS = [
  1_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 180_000, 240_000,
  300_000,
] as const;
const RESET_GRACE_MILLISECONDS = 60_000;

/** What the next attempt may continue after the previous failed attempt. */
export interface RetryAttemptContext {
  /** Counts from 1; the first attempt is not a retry. */
  readonly attemptNumber: number;
  /** The native session the adapter resumes; `null` opens a new one. */
  readonly resumeSessionId: string | null;
  /** The previous attempt was a technical failure and no native session can continue. */
  readonly isNewSessionAfterFailure: boolean;
}

interface RetryWork {
  readonly signal: AbortSignal;
  readonly previous: AgentPlanRetry | null;
  /** Shared ACP sessions cannot be replaced without losing their preceding turns. */
  readonly isSharedSession: boolean;
  /** A remote one-shot attempt cannot continue a native session. */
  readonly isRemote?: boolean;
  /** Reading-only remote work has no possible external mutation to duplicate. */
  readonly isReadOnly?: boolean;
  /** The record of the last failed attempt, after a pause and a reload as well. */
  readonly lastSession: () => AgentPlanSessionRecord | null;
  readonly attempt: (
    context: RetryAttemptContext,
  ) => Promise<Partial<AgentPlanStepResult>>;
  readonly waiting: () => void;
  readonly save: (
    retry: AgentPlanRetry,
  ) => Promise<AgentPlanSessionRecord | null>;
}

function retryPolicyOf(
  retry: AgentPlanRetry | null,
): AgentPlanRetryPolicy | null {
  if (!retry) return null;
  if (retry.policy) return retry.policy;
  return retry.attempts.some((attempt) => isPlanSessionRetryCode(attempt.code))
    ? "session"
    : "provider";
}

function hasToolActivity(session: AgentPlanSessionRecord): boolean {
  return session.events.some((event) => event.startsWith("tool "));
}

function canResumeSession(session: AgentPlanSessionRecord | null): boolean {
  return (
    typeof session?.sessionId === "string" &&
    session.sessionId.length > 0 &&
    session.continuationCapabilities?.canResume === true
  );
}

function hasConfirmedCloseout(
  session: AgentPlanSessionRecord | null | undefined,
): boolean {
  return (
    session?.closeout === "confirmed" || session?.closeout === "not_needed"
  );
}

/** Provider retries keep their earlier safety rule: no replay after tool activity or in a shared session. */
function hasUnsafeProviderReplay(
  session: AgentPlanSessionRecord | null | undefined,
  work: Pick<RetryWork, "isSharedSession" | "isRemote" | "isReadOnly">,
): boolean {
  if (!session) return true;
  if (work.isSharedSession) return true;
  if (work.isRemote && work.isReadOnly !== true) return true;
  if (!hasConfirmedCloseout(session)) return true;
  return hasToolActivity(session);
}

/** A session retry continues natively, opens a clean session, or names the concrete safety blocker. */
function hasUnsafeSessionReplay(
  session: AgentPlanSessionRecord | null | undefined,
  work: Pick<RetryWork, "isSharedSession" | "isRemote" | "isReadOnly">,
): boolean {
  if (!session) return true;
  if (!hasConfirmedCloseout(session)) return true;
  if (canResumeSession(session)) return false;
  // Replacing a shared session would discard its earlier turns.
  if (work.isSharedSession) return true;
  // A remote one-shot has no native resume and records no tool effects; only reading is provably safe.
  if (work.isRemote && work.isReadOnly !== true) return true;
  // A new native session may duplicate effects whose tool calls were already recorded.
  return hasToolActivity(session);
}

function retryAttempt(
  session: AgentPlanSessionRecord | null | undefined,
  code: AgentPlanRetryAttempt["code"],
): AgentPlanRetryAttempt {
  return {
    attemptId: session?.attemptId ?? null,
    sessionId: session?.sessionId ?? null,
    endedAt: session?.endedAt ?? new Date().toISOString(),
    code,
  };
}

function failureCode(
  result: Partial<AgentPlanStepResult>,
): AgentPlanRetryAttempt["code"] | null {
  if (isPlanRetryCode(result.error)) return result.error;
  if (isPlanSessionRetryCode(result.error)) return result.error;
  return null;
}

function retryPolicyFor(
  previous: AgentPlanRetryPolicy | null,
  code: AgentPlanRetryAttempt["code"],
): AgentPlanRetryPolicy | null {
  if (previous === "provider") return isPlanRetryCode(code) ? "provider" : null;
  if (previous === "session") return "session";
  if (isPlanRetryCode(code)) return "provider";
  if (isPlanSessionRetryCode(code)) return "session";
  return null;
}

function hasUnsafeReplay(
  policy: AgentPlanRetryPolicy,
  session: AgentPlanSessionRecord | null | undefined,
  work: RetryWork,
): boolean {
  return policy === "session"
    ? hasUnsafeSessionReplay(session, work)
    : hasUnsafeProviderReplay(session, work);
}

function maximumAttempts(policy: AgentPlanRetryPolicy): number {
  return policy === "session"
    ? PLAN_SESSION_MAXIMUM_ATTEMPTS
    : PLAN_MAXIMUM_RETRIES + 1;
}

function retryDelay(
  policy: AgentPlanRetryPolicy,
  failedAttempts: number,
): number {
  return policy === "session"
    ? PLAN_SESSION_RETRY_DELAY_MILLISECONDS
    : PLAN_RETRY_DELAYS[failedAttempts - 1];
}

function retryReason(
  policy: AgentPlanRetryPolicy,
  resetAt: string | null,
): AgentPlanRetry["reason"] {
  if (resetAt !== null) return "quota";
  return policy === "session" ? "session" : "transient";
}

function retryDecision(
  result: Partial<AgentPlanStepResult>,
  work: RetryWork,
  previous: AgentPlanRetry | null,
): AgentPlanRetry | null {
  if (result.status !== "failed") return null;
  const code = failureCode(result);
  if (code === null) return null;
  const previousPolicy = retryPolicyOf(previous);
  const policy = retryPolicyFor(previousPolicy, code);
  const session = result.session;
  const resetAt = session?.providerFailure?.resetAt ?? null;
  const attempts = [...(previous?.attempts ?? []), retryAttempt(session, code)];
  if (policy === null)
    return previousPolicy === null
      ? null
      : {
          policy: previousPolicy,
          attempts,
          resetAt,
          state: "blocked",
          reason: "failed",
          nextAttemptAt: null,
        };
  const base = { policy, attempts, resetAt, nextAttemptAt: null };
  if (hasUnsafeReplay(policy, session, work))
    return { ...base, state: "blocked", reason: "unsafe" };
  if (result.error === "provider_quota_exhausted" && resetAt === null)
    return { ...base, state: "blocked", reason: "reset_unknown" };
  if (attempts.length >= maximumAttempts(policy))
    return { ...base, state: "blocked", reason: "exhausted" };
  const delay = retryDelay(policy, attempts.length);
  const release =
    resetAt === null ? 0 : Date.parse(resetAt) + RESET_GRACE_MILLISECONDS;
  return {
    ...base,
    state: "waiting",
    reason: retryReason(policy, resetAt),
    nextAttemptAt: new Date(
      Math.max(Date.now() + delay, release),
    ).toISOString(),
  };
}

function retryContinuation(
  retry: AgentPlanRetry,
  work: RetryWork,
): RetryAttemptContext {
  const attemptNumber = retry.attempts.length + 1;
  if (retryPolicyOf(retry) === "session") {
    const last = retry.attempts.at(-1);
    const session = work.lastSession();
    const isResumeUsable =
      last?.code !== "acp_session_resume_failed" &&
      canResumeSession(session) &&
      session?.sessionId === last?.sessionId;
    return {
      attemptNumber,
      resumeSessionId: isResumeUsable ? (last?.sessionId ?? null) : null,
      isNewSessionAfterFailure: !isResumeUsable,
    };
  }
  return {
    attemptNumber,
    resumeSessionId: null,
    isNewSessionAfterFailure: false,
  };
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

/** Returns the terminal history of an exhausted sequence instead of starting another attempt. */
function exhaustedResult(work: RetryWork): Partial<AgentPlanStepResult> | null {
  const retry = work.previous;
  if (retry?.state !== "blocked" || retry.reason !== "exhausted") return null;
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
    nextAttemptAt: isPaused ? new Date().toISOString() : null,
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
  const exhausted = exhaustedResult(work);
  if (exhausted) return exhausted;
  let retry = work.previous;
  let continuation: RetryAttemptContext = retry
    ? retryContinuation(retry, work)
    : {
        attemptNumber: 1,
        resumeSessionId: null,
        isNewSessionAfterFailure: false,
      };
  for (;;) {
    if (retry?.state === "waiting") {
      await waitForRetry(retry, work);
      continuation = retryContinuation(retry, work);
      retry = { ...retry, state: "running", nextAttemptAt: null };
      await work.save(retry);
    }
    work.signal.throwIfAborted();
    const result = await work.attempt(continuation);
    if (work.signal.aborted) return abortedResult(retry, work, result);
    const next = retryDecision(result, work, retry);
    if (next) {
      retry = next;
      // Close dispatch before the persistence await, so a concurrent pause can abort this wait.
      if (retry.state === "waiting") work.waiting();
      const session = await work.save(retry);
      if (retry.state === "blocked")
        return { ...result, isBlocked: true, session };
      continuation = retryContinuation(retry, work);
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

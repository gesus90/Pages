import { setTimeout as wait } from "node:timers/promises";

import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import {
  PLAN_BLOCKER_RETRIES,
  PLAN_INFRASTRUCTURE_RETRY_DELAYS,
} from "@/definition/AgentPlanRetry";

import {
  canReturnPlanFailureToAgent,
  classifyPlanStepFailure,
  failedPlanAttempts,
} from "./AgentPlanBlockerRules";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanBlockerClass,
  AgentPlanRetry,
  AgentPlanRetryAttempt,
} from "@/definition/AgentPlanRetry";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

const RESET_GRACE_MILLISECONDS = 60_000;
const MAXIMUM_ATTEMPT_ISSUES = 50;
const MAXIMUM_ISSUE_LENGTH = 200;

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
  /** A script is no agent and Pages cannot reconcile its effects, so it never runs twice on its own. */
  readonly isScript?: boolean;
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

/** Local sessions record tool events; a remote runner proves its tool activity or lack of it. */
export function hasToolActivity(session: AgentPlanSessionRecord): boolean {
  return (
    session.events.some((event) => event.startsWith("tool ")) ||
    (session.effects !== undefined && session.effects.tools !== "none")
  );
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

/**
 * A session retry continues natively, opens a clean session, or names the concrete safety blocker.
 *
 * @remarks
 * Each blocker names a different cause, so none is presented as an
 * exhausted budget: a break in the cleanup, a native session that is
 * required but cannot continue, a session that was never kept, a remote
 * runner without evidence, and tool effects nobody can reconcile.
 */
function hasUnsafeSessionReplay(
  session: AgentPlanSessionRecord | null | undefined,
  work: Pick<RetryWork, "isSharedSession" | "isRemote" | "isReadOnly">,
  requiredResumeSessionId: string | undefined,
  code: AgentPlanRetryAttempt["code"],
): AgentPlanRetry["reason"] | null {
  if (!session) return "effect_unknown";
  if (!hasConfirmedCloseout(session)) return "closeout_unconfirmed";
  if (requiredResumeSessionId)
    return code === "acp_session_resume_failed" ? "resume_unavailable" : null;
  if (canResumeSession(session)) return null;
  // Replacing a shared session would discard its earlier turns.
  if (work.isSharedSession) return "resume_unavailable";
  // A runner without continuation support reports neither tool effects nor a session.
  if (work.isRemote && work.isReadOnly !== true && !session.effects)
    return "remote_evidence_missing";
  if (!hasToolActivity(session)) return null;
  // A new native session may duplicate effects whose tool calls were already recorded.
  return session.continuationCapabilities?.canResume === false
    ? "session_not_kept"
    : "effect_unknown";
}

/**
 * One failed attempt for the history.
 *
 * @param session - The record of this attempt; absent for a start refused before it had one.
 * @param code - The code it failed with.
 * @param failureClass - The class of the failure.
 * @param lastSessionId - The native session the sequence stands on, which a refused start did not leave.
 */
function retryAttempt(
  session: AgentPlanSessionRecord | null | undefined,
  code: AgentPlanRetryAttempt["code"],
  failureClass: AgentPlanBlockerClass,
  lastSessionId: string | null | undefined,
): AgentPlanRetryAttempt {
  const issues = (session?.acceptance?.issues ?? [])
    .slice(0, MAXIMUM_ATTEMPT_ISSUES)
    .map((issue) => issue.slice(0, MAXIMUM_ISSUE_LENGTH));
  return {
    attemptId: session?.attemptId ?? null,
    sessionId: session?.sessionId ?? lastSessionId ?? null,
    endedAt: session?.endedAt ?? new Date().toISOString(),
    code,
    failureClass,
    ...(issues.length > 0 ? { issues } : {}),
  };
}

function retryDelay(
  failureClass: AgentPlanBlockerClass,
  failedAttempts: number,
): number {
  if (failureClass !== "infrastructure") return 0;
  return PLAN_INFRASTRUCTURE_RETRY_DELAYS[
    Math.min(failedAttempts, PLAN_INFRASTRUCTURE_RETRY_DELAYS.length) - 1
  ];
}

function retryReason(
  failureClass: AgentPlanBlockerClass,
  code: AgentPlanRetryAttempt["code"],
  resetAt: string | null,
): AgentPlanRetry["reason"] {
  if (failureClass !== "infrastructure") return "repair";
  if (resetAt !== null) return "quota";
  return isPlanRetryCode(code) ? "transient" : "session";
}

/** The native session a tool-using or shared attempt must keep across every later attempt. */
function pinnedResumeSession(
  previous: AgentPlanRetry | null,
  session: AgentPlanSessionRecord | null | undefined,
  work: RetryWork,
): string | undefined {
  if (previous?.requiredResumeSessionId)
    return previous.requiredResumeSessionId;
  if (!session || !canResumeSession(session)) return undefined;
  if (!hasToolActivity(session) && !work.isSharedSession) return undefined;
  return session.sessionId ?? undefined;
}

/** What decides whether a failed attempt may be followed by another one. */
interface BlockerFacts {
  readonly failureClass: AgentPlanBlockerClass;
  readonly error: string | null | undefined;
  readonly code: AgentPlanRetryAttempt["code"];
  readonly session: AgentPlanSessionRecord | null | undefined;
  readonly requiredResumeSessionId: string | undefined;
  readonly resetAt: string | null;
  readonly failedAttempts: number;
}

/** The concrete reason no further attempt may start, or `null` when one may. */
function retryBlocker(
  work: RetryWork,
  facts: BlockerFacts,
): AgentPlanRetry["reason"] | null {
  const unsafe = hasUnsafeSessionReplay(
    facts.session,
    work,
    facts.requiredResumeSessionId,
    facts.code,
  );
  if (unsafe) return unsafe;
  if (facts.error === "provider_quota_exhausted" && facts.resetAt === null)
    return "reset_unknown";
  return facts.failedAttempts > PLAN_BLOCKER_RETRIES[facts.failureClass]
    ? "exhausted"
    : null;
}

/**
 * The reason a failure ends the step whatever its budget says, or `null`.
 *
 * @remarks
 * A hard stop is never repeated. A functional failure without a regular agent
 * turn has nothing to send a repair to: a refused start fails the same way again.
 */
function terminalReason(
  failureClass: AgentPlanBlockerClass,
  result: Partial<AgentPlanStepResult>,
): AgentPlanRetry["reason"] | null {
  if (failureClass === "harm") return "hard_stop";
  if (failureClass === "infrastructure") return null;
  return canReturnPlanFailureToAgent(failureClass, {
    error: result.error,
    acceptance: result.session?.acceptance,
  })
    ? null
    : "failed";
}

/** Whether a further attempt may follow, and when; the budget and the safety of a replay decide. */
function nextRetryState(
  work: RetryWork,
  facts: BlockerFacts,
): Pick<AgentPlanRetry, "state" | "reason" | "nextAttemptAt"> {
  const blocker = retryBlocker(work, facts);
  if (blocker)
    return { state: "blocked", reason: blocker, nextAttemptAt: null };
  const delay = retryDelay(facts.failureClass, facts.failedAttempts);
  const release =
    facts.resetAt === null
      ? 0
      : Date.parse(facts.resetAt) + RESET_GRACE_MILLISECONDS;
  return {
    state: "waiting",
    reason: retryReason(facts.failureClass, facts.code, facts.resetAt),
    nextAttemptAt: new Date(
      Math.max(Date.now() + delay, release),
    ).toISOString(),
  };
}

function reportedReset(
  session: AgentPlanSessionRecord | null | undefined,
): string | null {
  return session?.providerFailure?.resetAt ?? null;
}

function retryDecision(
  result: Partial<AgentPlanStepResult>,
  work: RetryWork,
  previous: AgentPlanRetry | null,
): AgentPlanRetry | null {
  if (result.status !== "failed" || work.isScript) return null;
  const session = result.session;
  const code = result.error ?? "plan_step_failed";
  const failureClass = classifyPlanStepFailure({
    error: result.error,
    acceptance: session?.acceptance,
    output: result.output,
  });
  const terminal = terminalReason(failureClass, result);
  // A first failure that ends the step at once has no sequence to record; its stop is on the step.
  if (terminal && !previous) return null;
  const resetAt = reportedReset(session);
  // What decides a replay is the newest record that exists: a refused start changed nothing of it.
  const replayed = session ?? work.lastSession();
  const attempts = [
    ...(previous?.attempts ?? []),
    retryAttempt(session, code, failureClass, replayed?.sessionId),
  ];
  const requiredResumeSessionId = pinnedResumeSession(previous, replayed, work);
  const base = {
    failureClass,
    attempts,
    resetAt,
    ...(requiredResumeSessionId ? { requiredResumeSessionId } : {}),
  };
  if (terminal)
    return { ...base, state: "blocked", reason: terminal, nextAttemptAt: null };
  return {
    ...base,
    ...nextRetryState(work, {
      failureClass,
      error: result.error,
      code,
      session: replayed,
      requiredResumeSessionId,
      resetAt,
      failedAttempts: failedPlanAttempts(attempts, failureClass),
    }),
  };
}

function retryContinuation(
  retry: AgentPlanRetry,
  work: RetryWork,
): RetryAttemptContext {
  const attemptNumber = retry.attempts.length + 1;
  const last = retry.attempts.at(-1);
  const session = work.lastSession();
  const isResumeUsable =
    last?.code !== "acp_session_resume_failed" &&
    (retry.requiredResumeSessionId !== undefined ||
      (canResumeSession(session) && session?.sessionId === last?.sessionId));
  // The newest attempt's session is the one to continue; the pinned ID only covers an attempt that never reported one.
  const resumeSessionId =
    last?.sessionId ?? retry.requiredResumeSessionId ?? null;
  return {
    attemptNumber,
    resumeSessionId: isResumeUsable ? resumeSessionId : null,
    isNewSessionAfterFailure: !isResumeUsable,
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
    // A pause is no failure, also without an abort: the sequence goes on from where it stands after the resume.
    if (work.signal.aborted || result.status === "paused")
      return abortedResult(retry, work, result);
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

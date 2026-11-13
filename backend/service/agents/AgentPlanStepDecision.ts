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

/**
 * How the turn of a step ended, the same for every provider.
 *
 * @remarks
 * `succeeded`: a valid `report_step_result` with met acceptance and the end
 * of the turn; Pages closes the session. `stopped`: a person stopped the run,
 * nothing resumes. Every other end is a failure of one blocker class: `form`
 * for a turn without a valid report, `harm` for a report with `blocked`, and
 * `infrastructure` for a crashed adapter, a broken ACP transport, an
 * unexpected end of the process or a session lost with a restart of Pages.
 */
export type PlanStepCompletion =
  | { readonly kind: "succeeded" }
  | { readonly kind: "stopped" }
  | {
      readonly kind: "failed";
      readonly failureClass: AgentPlanBlockerClass;
    };

/** What the next attempt may continue after the previous failed attempt. */
export interface RetryAttemptContext {
  /** Counts from 1; the first attempt is not a retry. */
  readonly attemptNumber: number;
  /** The native session the adapter resumes; `null` opens a new one. */
  readonly resumeSessionId: string | null;
  /** The previous attempt was a technical failure and no native session can continue. */
  readonly isNewSessionAfterFailure: boolean;
}

/** What the decision about a further attempt knows of the work of the step. */
export interface PlanRetryWork {
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
}

/** How an automatic restart after a restart of Pages goes on. */
export type PlanRestartDecision =
  | { readonly kind: "exhausted" }
  | { readonly kind: "wait"; readonly delayMilliseconds: number };

/** How the session of a run continued after a restart of Pages starts. */
export type PlanRestartSessionMode =
  "native_resume" | "new_session" | "effect_unknown";

/** Local sessions record tool events; a remote runner proves its tool activity or lack of it. */
export function hasToolActivity(session: AgentPlanSessionRecord): boolean {
  return (
    session.events.some((event) => event.startsWith("tool ")) ||
    (session.effects !== undefined && session.effects.tools !== "none")
  );
}

/**
 * The native session a further attempt continues over ACP, or `null`.
 *
 * @param session - The record of the last attempt.
 * @returns The session ID when the adapter confirmed it can resume it.
 */
export function resumableSessionId(
  session: Pick<
    AgentPlanSessionRecord,
    "sessionId" | "continuationCapabilities"
  > | null,
): string | null {
  return typeof session?.sessionId === "string" &&
    session.sessionId.length > 0 &&
    session.continuationCapabilities?.canResume === true
    ? session.sessionId
    : null;
}

/**
 * Decides how the turn of a step ended.
 *
 * @param result - The result of the attempt.
 * @param isStopped - A person stopped the run.
 * @returns Success, stop, or the class of the failure.
 */
export function decidePlanStepCompletion(
  result: Pick<Partial<AgentPlanStepResult>, "status" | "error" | "output"> & {
    readonly session?: Pick<AgentPlanSessionRecord, "acceptance"> | null;
  },
  isStopped: boolean,
): PlanStepCompletion {
  if (isStopped) return { kind: "stopped" };
  if (result.status === "succeeded") return { kind: "succeeded" };
  return {
    kind: "failed",
    failureClass: classifyPlanStepFailure({
      error: result.error,
      acceptance: result.session?.acceptance,
      output: result.output,
    }),
  };
}

/** The blocker class of a failed attempt, as {@link decidePlanStepCompletion} names it. */
function failureClassOf(
  result: Partial<AgentPlanStepResult>,
): AgentPlanBlockerClass {
  const completion = decidePlanStepCompletion(result, false);
  return completion.kind === "failed" ? completion.failureClass : "open";
}

function hasConfirmedCloseout(
  session: AgentPlanSessionRecord | null | undefined,
): boolean {
  return (
    session?.closeout === "confirmed" || session?.closeout === "not_needed"
  );
}

/**
 * The safety blocker of a replay, or `null` when a further attempt may start.
 *
 * @remarks
 * Each blocker names a different cause, so none is presented as an
 * exhausted budget: a break in the cleanup, a native session that is
 * required but cannot continue, a session that was never kept, a remote
 * runner without evidence, and tool effects nobody can reconcile.
 */
function hasUnsafeSessionReplay(
  session: AgentPlanSessionRecord | null | undefined,
  work: Pick<PlanRetryWork, "isSharedSession" | "isRemote" | "isReadOnly">,
  requiredResumeSessionId: string | undefined,
  code: AgentPlanRetryAttempt["code"],
): AgentPlanRetry["reason"] | null {
  if (!session) return "effect_unknown";
  if (!hasConfirmedCloseout(session)) return "closeout_unconfirmed";
  if (requiredResumeSessionId)
    return code === "acp_session_resume_failed" ? "resume_unavailable" : null;
  if (resumableSessionId(session) !== null) return null;
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

/**
 * The wait before the next attempt of an infrastructure failure: 10 s, 60 s, 300 s.
 *
 * @param failedAttempts - Failed attempts of the class so far, from 1.
 */
function infrastructureDelay(failedAttempts: number): number {
  return PLAN_INFRASTRUCTURE_RETRY_DELAYS[
    Math.min(
      Math.max(failedAttempts, 1),
      PLAN_INFRASTRUCTURE_RETRY_DELAYS.length,
    ) - 1
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

/**
 * The native session every later attempt continues.
 *
 * @remarks
 * A resumable native session is continued whether or not tool events were
 * recorded: it keeps what the agent did, and a new session would start over.
 */
function pinnedResumeSession(
  previous: AgentPlanRetry | null,
  session: AgentPlanSessionRecord | null | undefined,
): string | undefined {
  if (previous?.requiredResumeSessionId)
    return previous.requiredResumeSessionId;
  return resumableSessionId(session ?? null) ?? undefined;
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
  work: PlanRetryWork,
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
  work: PlanRetryWork,
  facts: BlockerFacts,
): Pick<AgentPlanRetry, "state" | "reason" | "nextAttemptAt"> {
  const blocker = retryBlocker(work, facts);
  if (blocker)
    return { state: "blocked", reason: blocker, nextAttemptAt: null };
  const delay =
    facts.failureClass === "infrastructure"
      ? infrastructureDelay(facts.failedAttempts)
      : 0;
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

/**
 * Decides whether and when a failed attempt of a step is followed by another one.
 *
 * @param result - The result of the attempt that just ended.
 * @param work - What the step is: shared, remote, a script.
 * @param previous - The retry state before this attempt.
 * @returns The new retry state, or `null` when the result stands as it is.
 *
 * @remarks
 * The one decision of every automatic retry, for all providers: an
 * `infrastructure` failure waits 10 s, 60 s and 300 s and blocks only after
 * the third restart failed; `form` and `open` go back to the agent; `harm`
 * stops. The safety stops stay: unconfirmed cleanup, a required session that
 * cannot resume, effects nobody can reconcile and a quota without a reset.
 */
export function decidePlanStepRetry(
  result: Partial<AgentPlanStepResult>,
  work: PlanRetryWork,
  previous: AgentPlanRetry | null,
): AgentPlanRetry | null {
  if (!shouldConsiderRetry(result, work)) return null;
  const session = result.session;
  const code = result.error ?? "plan_step_failed";
  const failureClass = failureClassOf(result);
  const terminal = terminalReason(failureClass, result);
  // A first failure that ends the step at once has no sequence to record; its stop is on the step.
  if (terminal && !previous) return null;
  const resetAt = session?.providerFailure?.resetAt ?? null;
  // What decides a replay is the newest record that exists: a refused start changed nothing of it.
  const replayed = session ?? work.lastSession();
  const attempts = [
    ...(previous?.attempts ?? []),
    retryAttempt(session, code, failureClass, replayed?.sessionId),
  ];
  const requiredResumeSessionId = pinnedResumeSession(previous, replayed);
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

/**
 * Which native session the next attempt continues.
 *
 * @param retry - The retry state the next attempt starts from.
 * @param lastSession - The record of the last attempt.
 */
export function decidePlanRetryContinuation(
  retry: AgentPlanRetry,
  lastSession: AgentPlanSessionRecord | null,
): RetryAttemptContext {
  const attemptNumber = retry.attempts.length + 1;
  const last = retry.attempts.at(-1);
  const isResumeUsable =
    last?.code !== "acp_session_resume_failed" &&
    (retry.requiredResumeSessionId !== undefined ||
      (resumableSessionId(lastSession) !== null &&
        lastSession?.sessionId === last?.sessionId));
  // The newest attempt's session is the one to continue; the pinned ID only covers an attempt that never reported one.
  const resumeSessionId =
    last?.sessionId ?? retry.requiredResumeSessionId ?? null;
  return {
    attemptNumber,
    resumeSessionId: isResumeUsable ? resumeSessionId : null,
    isNewSessionAfterFailure: !isResumeUsable,
  };
}

/**
 * Whether a step may be taken up on its own after a restart of Pages.
 *
 * @param step - A step of the interrupted run.
 * @returns `true` for a step that did not fail and for an `infrastructure` failure.
 */
export function canResumeAfterRestart(step: AgentPlanStepResult): boolean {
  if (step.status !== "failed") return true;
  const completion = decidePlanStepCompletion(step, false);
  return (
    completion.kind === "failed" && completion.failureClass === "infrastructure"
  );
}

/**
 * Decides the automatic restart of a run a restart of Pages interrupted.
 *
 * @param attempt - Which automatic restart of the chain this is, from 1.
 * @returns The wait of the same budget as every `infrastructure` retry, or that it is used up.
 */
export function decideAutomaticRestart(attempt: number): PlanRestartDecision {
  if (attempt > PLAN_BLOCKER_RETRIES.infrastructure)
    return { kind: "exhausted" };
  return { kind: "wait", delayMilliseconds: infrastructureDelay(attempt) };
}

/**
 * How the sessions of a run continue after a restart of Pages.
 *
 * @param sessions - The records of the retried steps.
 * @param canResumeNatively - Every retried session can be resumed over ACP.
 * @returns A native resume; else a new session where no tool ran.
 */
export function decideRestartSessionMode(
  sessions: readonly (AgentPlanSessionRecord | null | undefined)[],
  canResumeNatively: boolean,
): PlanRestartSessionMode {
  if (canResumeNatively) return "native_resume";
  return sessions.some((session) => session && hasToolActivity(session))
    ? "effect_unknown"
    : "new_session";
}

function shouldConsiderRetry(
  result: Partial<AgentPlanStepResult>,
  work: PlanRetryWork,
): boolean {
  return (
    result.status === "failed" &&
    !work.isScript &&
    !result.session?.acceptance?.issues.includes("todo_returns_exhausted")
  );
}

import { setTimeout as wait } from "node:timers/promises";

import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import { PLAN_MAXIMUM_RETRIES } from "@/definition/AgentPlanRetry";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Growing waits before each of the ten retries; remote reconnects follow the same scheme. */
export const PLAN_RETRY_DELAYS = [
  1_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 180_000, 240_000,
  300_000,
] as const;
const RESET_GRACE_MILLISECONDS = 60_000;

interface RetryWork {
  readonly signal: AbortSignal;
  readonly previous: AgentPlanRetry | null;
  /** Shared ACP sessions cannot be replaced without losing their preceding turns. */
  readonly isSharedSession: boolean;
  readonly attempt: () => Promise<Partial<AgentPlanStepResult>>;
  readonly waiting: () => void;
  readonly save: (
    retry: AgentPlanRetry,
  ) => Promise<AgentPlanSessionRecord | null>;
}

function hasUnsafeReplay(
  session: AgentPlanSessionRecord | null | undefined,
  isSharedSession: boolean,
): boolean {
  return (
    !session ||
    isSharedSession ||
    (session.closeout !== "confirmed" && session.closeout !== "not_needed") ||
    session.events.some((event) => event.startsWith("tool "))
  );
}

function retryAttempt(
  session: AgentPlanSessionRecord | null | undefined,
  code: AgentPlanRetry["attempts"][number]["code"],
): AgentPlanRetry["attempts"][number] {
  return {
    attemptId: session?.attemptId ?? null,
    sessionId: session?.sessionId ?? null,
    endedAt: session?.endedAt ?? new Date().toISOString(),
    code,
  };
}

function retryDecision(
  result: Partial<AgentPlanStepResult>,
  work: RetryWork,
  previous: AgentPlanRetry | null,
): AgentPlanRetry | null {
  if (result.status !== "failed" || !isPlanRetryCode(result.error)) return null;
  const session = result.session;
  const resetAt = session?.providerFailure?.resetAt ?? null;
  const attempts = [
    ...(previous?.attempts ?? []),
    retryAttempt(session, result.error),
  ];
  const base = { attempts, resetAt, nextAttemptAt: null };
  if (hasUnsafeReplay(session, work.isSharedSession))
    return { ...base, state: "blocked", reason: "unsafe" };
  if (result.error === "provider_quota_exhausted" && resetAt === null)
    return { ...base, state: "blocked", reason: "reset_unknown" };
  if (attempts.length > PLAN_MAXIMUM_RETRIES)
    return { ...base, state: "blocked", reason: "exhausted" };
  const delay = PLAN_RETRY_DELAYS[attempts.length - 1];
  const release =
    resetAt === null ? 0 : Date.parse(resetAt) + RESET_GRACE_MILLISECONDS;
  return {
    ...base,
    state: "waiting",
    reason: resetAt === null ? "transient" : "quota",
    nextAttemptAt: new Date(
      Math.max(Date.now() + delay, release),
    ).toISOString(),
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

/** Retries one unfinished node after confirmed cleanup, with a persisted deadline and the same frozen routing. */
export async function runPlanStepWithRetry(
  work: RetryWork,
): Promise<Partial<AgentPlanStepResult>> {
  let retry = work.previous;
  for (;;) {
    if (retry?.state === "waiting") await waitForRetry(retry, work);
    if (retry) {
      retry = { ...retry, state: "running", nextAttemptAt: null };
      await work.save(retry);
    }
    work.signal.throwIfAborted();
    const result = await work.attempt();
    if (work.signal.aborted) {
      if (!retry) return result;
      const isPaused = result.status === "paused";
      const session = await work.save({
        ...retry,
        state: isPaused ? "waiting" : "cancelled",
        nextAttemptAt: isPaused ? new Date().toISOString() : null,
      });
      return { ...result, session };
    }
    const next = retryDecision(result, work, retry);
    if (next) {
      retry = next;
      // Close dispatch before the persistence await, so a concurrent pause can abort this wait.
      if (retry.state === "waiting") work.waiting();
      const session = await work.save(retry);
      if (retry.state === "blocked")
        return { ...result, isBlocked: true, session };
      continue;
    }
    if (!retry) return result;
    const state = result.status === "succeeded" ? "completed" : "blocked";
    const session = await work.save({ ...retry, state, nextAttemptAt: null });
    return { ...result, session };
  }
}

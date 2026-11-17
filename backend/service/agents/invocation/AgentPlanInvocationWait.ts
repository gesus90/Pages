import { logCaughtError } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { PLAN_JUMP_PORT } from "@/definition/AgentPlanJump";

import { hasUnconfirmedRunCloseout } from "../AgentPlanRunState";
import { endValues } from "./AgentPlanInvocationOutcome";
import { requireInvocationValuesWithinLimit } from "./AgentPlanInvocationValues";

import type {
  AgentPlanInvocationDecision,
  AgentPlanInvocationRecord,
  AgentPlanInvocationRepository,
} from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanInvocationWakeups } from "./AgentPlanInvocationWakeups";

/** The longest a waiter sleeps without a wake-up, as a safety net against a missed notification. */
const SAFETY_RECHECK_MS = 5 * 60_000;
/** How soon a successful target with unreleased resources is looked at again. */
const CLEANUP_RECHECK_MS = 1_000;
/** The longest delay a timer takes. */
const MAXIMUM_TIMER_MS = 2_147_483_647;
/** How long the end of a stopped called run is awaited. */
const STOP_WAIT_MS = 20_000;

/** What the wait needs from the process that composes the engine. */
export interface InvocationWaitDependencies {
  readonly invocations: Pick<
    AgentPlanInvocationRepository,
    | "find"
    | "signal"
    | "decide"
    | "decideTimeout"
    | "cancelStart"
    | "hasReservation"
    | "recordCleanupOpen"
  >;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
  readonly wakeups: AgentPlanInvocationWakeups;
  /** Stops a run of this process; resolves once the stop is accepted. */
  readonly stop: (runId: string) => Promise<void>;
}

/** What a look at an undecided call found. */
type Verdict = AgentPlanInvocationDecision | "wait" | null;

function returnValues(
  record: AgentPlanInvocationRecord,
  target: AgentPlanRun,
): Readonly<Record<string, AgentParameterValue>> {
  const returned = endValues(target);
  const values: Record<string, AgentParameterValue> = {};
  for (const declared of record.contract.returns) {
    const value = returned[declared.name];
    if (value?.type === declared.type)
      values[`return:${declared.name}`] = value;
  }
  requireInvocationValuesWithinLimit(values);
  return values;
}

function endedVerdict(
  record: AgentPlanInvocationRecord,
  target: AgentPlanRun,
): AgentPlanInvocationDecision | "wait" {
  const failed = (reason: string): AgentPlanInvocationDecision => ({
    state: "failed",
    reason,
    outcome: null,
  });
  if (record.wait === "signal") return failed("plan_jump_no_signal");
  if (hasUnconfirmedRunCloseout(target))
    return failed("plan_jump_cleanup_open");
  if (target.status === "cancelled")
    return failed("plan_jump_target_cancelled");
  if (target.status !== "succeeded") return failed("plan_jump_target_failed");
  return "wait";
}

/**
 * Decides calls and waits for their decision.
 * @remarks
 * A decision is made from stored facts only: an accepted signal, the end of
 * the called run, the deadline. A wake-up merely makes the waiter look again,
 * so nothing here polls the called run; the one short re-check is the
 * moment between the end of a successful run and the release of its
 * resources.
 */
export class AgentPlanInvocationWait {
  private readonly dependencies: InvocationWaitDependencies;

  public constructor(dependencies: InvocationWaitDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Looks at an undecided call once and decides it when the facts allow it.
   * @returns The call as it is stored afterwards, decided or not.
   */
  public async evaluate(
    record: AgentPlanInvocationRecord,
  ): Promise<AgentPlanInvocationRecord> {
    if (record.decidedAt !== null) return record;
    const now = new Date().toISOString();
    const verdict = await this.verdict(record);
    if (verdict !== null && verdict !== "wait")
      await this.dependencies.invocations.decide(record.id, verdict, now);
    else await this.dependencies.invocations.decideTimeout(record.id, now);
    return (await this.dependencies.invocations.find(record.id)) ?? record;
  }

  /**
   * Waits until the call is decided or the waiter is cancelled.
   * @param record - The call to wait for.
   * @param signal - Aborts the wait, as a stop of the calling run does.
   * @returns The call; undecided only when the wait was aborted.
   */
  public async wait(
    record: AgentPlanInvocationRecord,
    signal: AbortSignal,
  ): Promise<AgentPlanInvocationRecord> {
    let current = record;
    while (current.decidedAt === null && !signal.aborted) {
      current = await this.evaluate(current);
      if (current.decidedAt !== null) break;
      await this.sleep(current, signal);
    }
    return current;
  }

  /**
   * Cancels a call: withdraws a start that is still due and stops a called run that belongs to the call.
   * @returns Whether the cleanup of the called run is confirmed.
   * @remarks
   * A call that went on at once, or whose target went on after a signal, no
   * longer belongs to the calling run; its target is never stopped here.
   */
  public async cancel(
    record: AgentPlanInvocationRecord,
    reason: string,
  ): Promise<"confirmed" | "open"> {
    const now = new Date().toISOString();
    await this.dependencies.invocations.decide(
      record.id,
      { state: "cancelled", reason, outcome: null },
      now,
    );
    return this.release(record);
  }

  /**
   * Ends what still belongs to a decided or cancelled call.
   * @returns Whether the cleanup is confirmed.
   */
  public async release(
    record: AgentPlanInvocationRecord,
  ): Promise<"confirmed" | "open"> {
    const now = new Date().toISOString();
    const fresh =
      (await this.dependencies.invocations.find(record.id)) ?? record;
    if (fresh.isDetached) return "confirmed";
    if (fresh.start === "pending")
      await this.dependencies.invocations.cancelStart(fresh.id, now);
    if (fresh.targetRunId === null) return "confirmed";
    const result = await this.stopTarget(fresh.targetRunId);
    if (result === "open")
      await this.dependencies.invocations.recordCleanupOpen(fresh.id, now);
    return result;
  }

  private async stopTarget(runId: string): Promise<"confirmed" | "open"> {
    const target = await this.dependencies.runs.find(runId);
    if (target && isActivePlanRun(target.status)) {
      try {
        await this.dependencies.stop(runId);
      } catch (error: unknown) {
        logCaughtError("AgentPlanInvocationWait", error);
        return "open";
      }
    }
    const ended = await this.untilEnded(runId);
    return ended && !hasUnconfirmedRunCloseout(ended) ? "confirmed" : "open";
  }

  private async untilEnded(runId: string): Promise<AgentPlanRun | null> {
    const deadline = Date.now() + STOP_WAIT_MS;
    for (;;) {
      const run = await this.dependencies.runs.find(runId);
      if (run && !isActivePlanRun(run.status)) return run;
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250).unref();
      });
    }
  }

  private async verdict(record: AgentPlanInvocationRecord): Promise<Verdict> {
    if (record.wait === "signal" && record.signalName !== null) {
      const accepted = await this.dependencies.invocations.signal(
        record.id,
        record.signalName,
      );
      if (accepted)
        return {
          state: "signalled",
          reason: null,
          outcome: {
            values: accepted.payload
              ? { [PLAN_JUMP_PORT.payloadOut]: accepted.payload }
              : {},
          },
        };
    }
    const ended = await this.endedTarget(record);
    if (ended) {
      const decision = endedVerdict(record, ended);
      if (decision !== "wait") return decision;
      return this.successVerdict(record, ended);
    }
    return null;
  }

  private async successVerdict(
    record: AgentPlanInvocationRecord,
    target: AgentPlanRun,
  ): Promise<Verdict> {
    // The run is only done when it let go of its resources, which proves its cleanup finished.
    if (await this.dependencies.invocations.hasReservation(target.id))
      return "wait";
    return {
      state: "succeeded",
      reason: null,
      outcome: { values: returnValues(record, target) },
    };
  }

  private async endedTarget(
    record: AgentPlanInvocationRecord,
  ): Promise<AgentPlanRun | null> {
    if (record.targetRunId === null) return null;
    try {
      const target = await this.dependencies.runs.find(record.targetRunId);
      return target && !isActivePlanRun(target.status) ? target : null;
    } catch (error: unknown) {
      logCaughtError("AgentPlanInvocationWait", error);
      return null;
    }
  }

  private sleep(
    record: AgentPlanInvocationRecord,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        unsubscribe();
        signal.removeEventListener("abort", wake);
        resolve();
      };
      const unsubscribe = this.dependencies.wakeups.subscribe(record.id, wake);
      const timer = setTimeout(wake, this.delay(record));
      timer.unref();
      signal.addEventListener("abort", wake, { once: true });
      if (signal.aborted) {
        wake();
        return;
      }
    });
  }

  /** The time until the call could change by itself: its deadline, or the safety net. */
  private delay(record: AgentPlanInvocationRecord): number {
    const untilDeadline =
      record.deadlineAt === null
        ? SAFETY_RECHECK_MS
        : Date.parse(record.deadlineAt) - Date.now();
    const ended =
      record.targetStatus !== null && record.targetStatus !== "running";
    const limit = ended ? CLEANUP_RECHECK_MS : SAFETY_RECHECK_MS;
    return Math.max(50, Math.min(untilDeadline, limit, MAXIMUM_TIMER_MS));
  }
}

import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { endInterruptedSession } from "../AgentPlanRecovery";
import { classifyPlanFailure } from "./AgentPlanFailure";
import { canResumeAfterRestart } from "../AgentPlanStepDecision";
import { interruptedLoopRuns } from "./AgentPlanLoopRecovery";
import {
  detachedStopRun,
  endedPlanRun,
  isCompletedPlanRun,
  settleDetachedRun,
} from "../AgentPlanRunState";
import { markDetachedCloseoutBlocks } from "../AgentPlanDetachedBlocks";

import type { PlanDependencies } from "../AgentPlanService";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionAccess } from "../AgentPlanSessionAccess";

interface StartupRecoveryDependencies {
  readonly adopt?: (run: AgentPlanRun) => Promise<boolean>;
  readonly unverifiedLocal?: ReadonlySet<string>;
  readonly runs: Pick<AgentPlanRunRepository, "unfinished" | "interrupt"> &
    Partial<Pick<AgentPlanRunRepository, "snapshot" | "update">>;
  readonly sessions?: Pick<AgentPlanSessionAccess, "revoke">;
  readonly endSession?: typeof endInterruptedSession;
}

/** What one startup recovery did, as bare counts for the log. */
interface StartupRecoveryCounts {
  /** Local runs recorded as interrupted, failed or cancelled. */
  interrupted: number;
  /** Local runs whose nodes turned out to have all finished. */
  completedRuns: number;
  /** Remote runs whose durable state changed now. */
  remoteSettled: number;
}

function interruptedStep(
  step: AgentPlanStepResult,
  wasStopped: boolean,
): AgentPlanStepResult {
  if (step.status === "running")
    return {
      ...step,
      status: "failed",
      cancellation: wasStopped ? "requested" : "none",
      error: interruptionCode(step),
    };
  if (step.status === "waiting" || step.status === "paused")
    return { ...step, isBlocked: true, error: "plan_interrupted" };
  return step;
}

/** A session whose leftover stayed unconfirmed keeps a failed closeout, so its run retains its working copies. */
function retainUnconfirmed(
  previous: AgentPlanStepResult,
  ended: AgentPlanStepResult,
  retained: ReadonlySet<string>,
): AgentPlanStepResult {
  if (
    !ended.session ||
    previous.session?.closeout !== "pending" ||
    !retained.has(ended.session.instanceId)
  )
    return ended;
  return { ...ended, session: { ...ended.session, closeout: "failed" } };
}

/** Reconciles owned processes and durable views without dispatching any work. */
export class AgentPlanStartupRecovery {
  private readonly dependencies: StartupRecoveryDependencies;

  public constructor(dependencies: StartupRecoveryDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Preserves successful work and explicit cancellation; a process crash is a separate recoverable reason.
   * @param retained - Sessions whose leftover cleanup could not be confirmed;
   * their runs keep the working copies reserved.
   */
  public async recover(
    retained: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const endSession = this.dependencies.endSession ?? endInterruptedSession;
    const unfinished: AgentPlanRun[] = [];
    for (const run of await this.dependencies.runs.unfinished())
      if (!(await this.dependencies.adopt?.(run))) unfinished.push(run);
    const counts: StartupRecoveryCounts = {
      interrupted: 0,
      completedRuns: 0,
      remoteSettled: 0,
    };
    // Remote work stays owned by the durable runner journal until reconciliation.
    for (const previous of unfinished.filter(requiresLocalRecovery)) {
      const hasCompleted = await this.recoverLocalRun(
        previous,
        retained,
        endSession,
      );
      if (hasCompleted) counts.completedRuns += 1;
      else counts.interrupted += 1;
    }
    counts.remoteSettled = await this.settleRemoteRuns(
      unfinished.filter((run) => !requiresLocalRecovery(run)),
    );
    // Terminal workspace ownership is reconciled by AgentPlanWorkspaceLocks,
    // through the same process and transaction checks as an explicit release.
    // Stop could persist cancelled with a failed closeout or retained owner.
    // Previously those vetoed release before boot evidence was checked, while
    // legacy sessions without a namespace were never retried. The lease audit
    // also excluded plan leases. The original failed Stop itself cannot be
    // reconstructed from the remaining lock rows alone.
    logEvent({
      level: "info",
      event: "agent.recovery.startup_summary",
      component: "AgentPlanStartupRecovery",
      message: "Startup recovery reconciled unfinished plan runs",
      metadata: { runs: unfinished.length, ...counts },
    });
  }

  private async recoverLocalRun(
    previous: AgentPlanRun,
    retained: ReadonlySet<string>,
    endSession: typeof endInterruptedSession,
  ): Promise<boolean> {
    if (!previous.runnerJobs?.some((job) => job.closeout !== "confirmed"))
      await this.dependencies.sessions?.revoke(previous.id, null);
    const endNode = async (
      step: AgentPlanStepResult,
    ): Promise<AgentPlanStepResult> =>
      retainUnconfirmed(
        step,
        await this.endUnadoptedSession(step, previous.startedAt, endSession),
        retained,
      );
    const steps = await Promise.all(previous.steps.map(endNode));
    const loops = previous.loops
      ? await interruptedLoopRuns(previous.loops, {
          end: endNode,
          interrupt: (step) => interruptedStep(step, previous.stopRequested),
        })
      : undefined;
    const settledCandidate: AgentPlanRun = {
      ...previous,
      steps,
      ...(loops ? { loops } : {}),
    };
    if (isCompletedPlanRun(settledCandidate)) {
      await this.dependencies.runs.interrupt({
        ...endedPlanRun(settledCandidate, "succeeded"),
        recovery: undefined,
      });
      return true;
    }
    const hasTerminalFailure = previous.steps.some(
      (step) =>
        step.status === "failed" && classifyPlanFailure(step) === "terminal",
    );
    const run: AgentPlanRun = {
      ...endedPlanRun(
        previous,
        previous.stopRequested ? "cancelled" : "failed",
      ),
      ...(previous.stopRequested || hasTerminalFailure
        ? { recovery: undefined }
        : {
            recovery: {
              state: "interrupted" as const,
              requiresReconciliation: true,
              // The same decision as every automatic retry: only an infrastructure failure resumes on its own.
              automaticResume: previous.steps.every(canResumeAfterRestart)
                ? { state: "pending" as const }
                : { state: "stopped" as const, reason: "failure_class" },
            },
          }),
      steps: steps.map((step) => interruptedStep(step, previous.stopRequested)),
      ...(loops ? { loops } : {}),
    };
    await this.dependencies.runs.interrupt(run);
    return false;
  }

  private async endUnadoptedSession(
    step: AgentPlanStepResult,
    startedAt: string,
    endSession: typeof endInterruptedSession,
  ): Promise<AgentPlanStepResult> {
    if (
      step.session &&
      this.dependencies.unverifiedLocal?.has(step.session.instanceId)
    )
      return {
        ...step,
        status: "failed",
        error: "plan_local_owner_unverified",
        session: { ...step.session, closeout: "failed" },
      };
    return endSession(step, startedAt);
  }

  /**
   * A remote run whose jobs all ended before this start gets no later runner fact.
   * @returns How many remote runs changed.
   */
  private async settleRemoteRuns(
    runs: readonly AgentPlanRun[],
  ): Promise<number> {
    let settledRuns = 0;
    for (const source of runs) {
      const remote = await this.reconcileMixedLocal(source);
      const uncertain = remote.stopRequested
        ? {
            ...detachedStopRun(remote),
            steps: remote.steps.map((step) =>
              step.status === "running"
                ? {
                    ...step,
                    status: "failed" as const,
                    cancellation: "requested" as const,
                    error: "plan_stop_unconfirmed",
                  }
                : step,
            ),
          }
        : remote;
      let snapshot: unknown = null;
      if (
        !uncertain.stopRequested &&
        !uncertain.controlError &&
        !uncertain.steps.some((step) => step.status === "running") &&
        uncertain.steps.some(
          (step) => step.status === "failed" && step.role === "closeout",
        )
      ) {
        try {
          snapshot =
            (await this.dependencies.runs.snapshot?.(uncertain.id)) ?? null;
        } catch (error: unknown) {
          logCaughtError("AgentPlanStartupRecovery", error);
        }
      }
      const settled = settleDetachedRun(
        markDetachedCloseoutBlocks(uncertain, snapshot),
      );
      if (settled !== remote) {
        await this.dependencies.runs.interrupt(settled);
        settledRuns += 1;
      }
    }
    return settledRuns;
  }

  /** A mixed run keeps remote ownership while reconciling only its interrupted local processes. */
  private async reconcileMixedLocal(run: AgentPlanRun): Promise<AgentPlanRun> {
    const endSession = this.dependencies.endSession ?? endInterruptedSession;
    const steps = await Promise.all(
      run.steps.map(async (step) => {
        if (step.execution?.target.kind === "remote") return step;
        if (step.status !== "running") return step;
        await this.dependencies.sessions?.revoke(
          run.id,
          step.groupId ?? step.id,
        );
        return interruptedStep(
          await this.endUnadoptedSession(step, run.startedAt, endSession),
          run.stopRequested,
        );
      }),
    );
    if (steps.every((step, index) => step === run.steps[index])) return run;
    const reconciled = { ...run, steps };
    await this.dependencies.runs.interrupt(reconciled);
    return reconciled;
  }
}

function interruptionCode(step: AgentPlanStepResult): string {
  if (step.script?.closeout === "failed") return "plan_script_cleanup";
  return step.script ? "plan_script_interrupted" : "plan_interrupted";
}

function requiresLocalRecovery(run: AgentPlanRun): boolean {
  return (
    Boolean(run.runnerJobs?.length) ||
    !run.steps.some((step) => step.execution?.target.kind === "remote")
  );
}

/** Restores proven local owners before the legacy interruption and reservation cleanup paths. */
export async function recoverPlanStartup(
  dependencies: PlanDependencies,
  retained: ReadonlySet<string>,
): Promise<void> {
  await new AgentPlanStartupRecovery({
    ...dependencies,
    adopt: (run) => dependencies.engine.adopt?.(run) ?? Promise.resolve(false),
    unverifiedLocal:
      dependencies.engine.unverifiedLocalSessions?.() ?? new Set(),
  }).recover(retained);
}

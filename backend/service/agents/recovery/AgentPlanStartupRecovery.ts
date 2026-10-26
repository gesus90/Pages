import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import {
  endInterruptedSession,
  hasNoSessionProcesses,
} from "../AgentPlanRecovery";
import { classifyPlanFailure } from "./AgentPlanFailure";
import { interruptedLoopRuns } from "./AgentPlanLoopRecovery";
import { endInterruptedScript } from "../AgentPlanScriptRecovery";
import { detachedStopRun, settleDetachedRun } from "../AgentPlanRunState";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionAccess } from "../AgentPlanSessionAccess";

interface StartupRecoveryDependencies {
  readonly runs: Pick<
    AgentPlanRunRepository,
    "unfinished" | "interrupt" | "reserving" | "release"
  > &
    Partial<Pick<AgentPlanRunRepository, "update">>;
  readonly sessions?: Pick<AgentPlanSessionAccess, "revoke">;
  readonly endSession?: typeof endInterruptedSession;
  readonly hasNoProcesses?: typeof hasNoSessionProcesses;
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
   *
   * @param retained - Sessions whose leftover cleanup could not be confirmed;
   * their runs keep the working copies reserved.
   */
  public async recover(
    retained: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const endSession = this.dependencies.endSession ?? endInterruptedSession;
    const unfinished = await this.dependencies.runs.unfinished();
    // Remote work stays owned by the durable runner journal until reconciliation.
    for (const previous of unfinished.filter(requiresLocalRecovery)) {
      await this.dependencies.sessions?.revoke(previous.id, null);
      const endNode = async (
        step: AgentPlanStepResult,
      ): Promise<AgentPlanStepResult> =>
        retainUnconfirmed(
          step,
          await endSession(step, previous.startedAt),
          retained,
        );
      const steps = await Promise.all(previous.steps.map(endNode));
      const loops = previous.loops
        ? await interruptedLoopRuns(previous.loops, {
            end: endNode,
            interrupt: (step) => interruptedStep(step, previous.stopRequested),
          })
        : undefined;
      const hasTerminalFailure = previous.steps.some(
        (step) =>
          step.status === "failed" && classifyPlanFailure(step) === "terminal",
      );
      const run: AgentPlanRun = {
        ...previous,
        endedAt: new Date().toISOString(),
        status: previous.stopRequested ? "cancelled" : "failed",
        ...(previous.stopRequested || hasTerminalFailure
          ? { recovery: undefined }
          : {
              recovery: {
                state: "interrupted" as const,
                requiresReconciliation: true,
              },
            }),
        steps: steps.map((step) =>
          interruptedStep(step, previous.stopRequested),
        ),
        ...(loops ? { loops } : {}),
      };
      await this.dependencies.runs.interrupt(run);
    }
    await this.settleRemoteRuns(
      unfinished.filter((run) => !requiresLocalRecovery(run)),
    );
    const hasNoProcesses =
      this.dependencies.hasNoProcesses ?? hasNoSessionProcesses;
    for (const reserved of await this.dependencies.runs.reserving()) {
      const run = await this.reconcileScripts(reserved);
      if (
        allPlanRunResults(run).some(
          (step) =>
            step.script?.closeout === "failed" ||
            step.remote?.closeout === "pending" ||
            step.remote?.closeout === "failed",
        )
      )
        continue;
      const isRetained = allPlanRunResults(run).some(
        (step) => step.session && retained.has(step.session.instanceId),
      );
      if (!isRetained && (await hasNoProcesses(run)))
        await this.dependencies.runs.release(run.id);
    }
  }

  /** A remote run whose jobs all ended before this start gets no later runner fact. */
  private async settleRemoteRuns(runs: readonly AgentPlanRun[]): Promise<void> {
    for (const remote of runs) {
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
      const settled = settleDetachedRun(uncertain);
      if (settled !== remote) await this.dependencies.runs.interrupt(settled);
    }
  }

  private async reconcileScripts(run: AgentPlanRun): Promise<AgentPlanRun> {
    if (
      !this.dependencies.runs.update ||
      !run.steps.some(
        (step) => step.script && step.script.closeout !== "confirmed",
      )
    )
      return run;
    const steps = await Promise.all(run.steps.map(endInterruptedScript));
    const reconciled = { ...run, steps };
    await this.dependencies.runs.update(reconciled);
    return reconciled;
  }
}

function interruptionCode(step: AgentPlanStepResult): string {
  if (step.script?.closeout === "failed") return "plan_script_cleanup";
  return step.script ? "plan_script_interrupted" : "plan_interrupted";
}

function requiresLocalRecovery(run: AgentPlanRun): boolean {
  return !run.steps.some((step) => step.execution?.target.kind === "remote");
}

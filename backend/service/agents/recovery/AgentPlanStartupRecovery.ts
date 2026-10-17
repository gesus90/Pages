import {
  endInterruptedSession,
  hasNoSessionProcesses,
} from "../AgentPlanRecovery";
import { classifyPlanFailure } from "./AgentPlanFailure";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionAccess } from "../AgentPlanSessionAccess";

interface StartupRecoveryDependencies {
  readonly runs: Pick<
    AgentPlanRunRepository,
    "unfinished" | "interrupt" | "reserving" | "release"
  >;
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
      error: "plan_interrupted",
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
    for (const previous of await this.dependencies.runs.unfinished()) {
      await this.dependencies.sessions?.revoke(previous.id, null);
      const steps = await Promise.all(
        previous.steps.map(async (step) =>
          retainUnconfirmed(
            step,
            await endSession(step, previous.startedAt),
            retained,
          ),
        ),
      );
      const hasTerminalFailure = previous.steps.some(
        (step) =>
          step.status === "failed" && classifyPlanFailure(step) === "terminal",
      );
      const run: AgentPlanRun = {
        ...previous,
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
      };
      await this.dependencies.runs.interrupt(run);
    }
    const hasNoProcesses =
      this.dependencies.hasNoProcesses ?? hasNoSessionProcesses;
    for (const run of await this.dependencies.runs.reserving()) {
      const isRetained = run.steps.some(
        (step) => step.session && retained.has(step.session.instanceId),
      );
      if (!isRetained && (await hasNoProcesses(run)))
        await this.dependencies.runs.release(run.id);
    }
  }
}

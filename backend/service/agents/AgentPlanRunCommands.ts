import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { readySteps } from "./AgentPlanRunState";
import { stopPlanRun } from "./AgentPlanStop";
import { planPauseGate } from "./AgentPlanPauseGate";
import { controlPlanProcesses } from "./AgentPlanProcessControl";
import {
  preparePlanContinuation,
  planWritingWorkspaces,
} from "./AgentPlanContinuation";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { EngineDependencies } from "./AgentPlanRunEngine";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

interface CommandDependencies extends EngineDependencies {
  readonly active: Map<string, ActivePlanRun>;
  readonly writes: SerialQueue;
  readonly isClosing: () => boolean;
  readonly pump: () => Promise<void>;
}

function pausedOwnership(step: AgentPlanStepResult): string {
  const { remote, session, script } = step;
  return JSON.stringify({
    remote: remote ? [remote.jobId, remote.sessionId, remote.launchId] : null,
    session: session
      ? [
          session.instanceId,
          session.attemptId,
          session.sessionId,
          session.processId,
          session.namespace,
        ]
      : null,
    script: script
      ? [script.instanceId, script.processId, script.namespace]
      : null,
  });
}

function hasSamePausedWork(
  previous: AgentPlanRun,
  current: AgentPlanRun,
): boolean {
  return (
    current.steps.length === previous.steps.length &&
    previous.steps.every((step, index) => {
      const stored = current.steps[index];
      if (!stored) return false;
      if (
        step.execution &&
        JSON.stringify(stored.execution) !== JSON.stringify(step.execution)
      )
        return false;
      if (step.execution?.target.kind === "remote")
        return stored.id === step.id;
      return (
        stored.id === step.id &&
        stored.status === step.status &&
        stored.cancellation === step.cancellation &&
        pausedOwnership(stored) === pausedOwnership(step)
      );
    })
  );
}

/** Serial durable run commands; execution gates change only after the state and journal commit. */
export class AgentPlanRunCommands {
  private readonly dependencies: CommandDependencies;

  public constructor(dependencies: CommandDependencies) {
    this.dependencies = dependencies;
  }

  /** Journals a stop before cancelling owned executions. */
  public async stop(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await stopPlanRun(id, this.dependencies, journal);
  }

  /**
   * Ends a run because the server shuts down, without recording a stop of its executor.
   *
   * @remarks
   * Dispatch closes and every execution is aborted like a stop, but the run
   * closes as interrupted, so its executor can resume it after the restart.
   */
  public async interrupt(id: string): Promise<void> {
    await this.dependencies.writes.run(async () => {
      const active = this.dependencies.active.get(id);
      if (!active) return;
      active.isInterrupted = true;
      if (isActivePlanRun(active.view.status)) {
        active.view = {
          ...active.view,
          status: "stopping",
          isWaitingForWorkspace: undefined,
          workspaceWait: undefined,
        };
        await this.dependencies.runs.update(active.view);
      }
      for (const controller of active.controllers.values()) controller.abort();
    });
    this.schedulePump();
  }

  /** Journals a pause before gating waiting steps. */
  public async pause(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await this.dependencies.writes.run(async () => {
      const active = this.dependencies.active.get(id);
      if (
        active &&
        !active.view.stopRequested &&
        ["paused", "pausing"].includes(active.view.status)
      ) {
        if (journal)
          await this.dependencies.runs.update(
            active.view,
            undefined,
            undefined,
            journal,
          );
        return;
      }
      if (
        !active ||
        active.view.stopRequested ||
        active.view.status !== "running"
      )
        throw new AgentError("plan_run_unavailable");
      const proposed: AgentPlanRun = {
        ...active.view,
        status: "paused",
        pauseBoundary: {
          pausedAt: new Date().toISOString(),
          completedStepIds: active.view.steps
            .filter((step) => step.status === "succeeded")
            .map((step) => step.id),
          pendingStepIds: active.view.steps
            .filter((step) =>
              ["waiting", "paused", "running"].includes(step.status),
            )
            .map((step) => step.id),
          frontierStepIds: [
            ...new Set([
              ...active.view.steps
                .filter((step) => step.status === "running")
                .map((step) => step.id),
              ...readySteps(active).map((node) => node.id),
              ...(active.branching?.pending.map((event) => event.targetId) ??
                []),
            ]),
          ],
        },
        isWaitingForWorkspace: undefined,
        workspaceWait: undefined,
        steps: active.view.steps.map((step) =>
          step.status === "waiting" ? { ...step, status: "paused" } : step,
        ),
      };
      await this.dependencies.runs.update(
        proposed,
        undefined,
        undefined,
        journal,
      );
      active.view = proposed;
      planPauseGate(id).pause();
      this.dependencies.resources?.pauseRun(id);
      await Promise.all([
        controlPlanProcesses(proposed, "pause"),
        this.dependencies.resources?.controlRun?.(id, "pause"),
        this.dependencies.remoteExecution?.pause(proposed),
      ]);
    });
    await this.dependencies.pump();
  }

  /** Journals continuation adoption before restarting scheduling. */
  public async resume(
    id: string,
    snapshot?: AgentPlanSnapshot,
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    await this.dependencies.writes.run(async () => {
      const active = this.dependencies.active.get(id);
      if (
        !active ||
        this.dependencies.isClosing() ||
        active.view.stopRequested ||
        active.hasPersistenceFailure ||
        active.view.status !== "paused"
      )
        throw new AgentError("plan_run_unavailable");
      const previous = await this.pausedView(active);
      const proposed = snapshot ?? active.snapshot;
      const next = preparePlanContinuation(previous, active.snapshot, proposed);
      await this.adoptContinuation(active, next, previous, journal);
      active.snapshot = next.snapshot;
      active.view = next.run;
      this.dependencies.steps.revise?.(id);
      await controlPlanProcesses(active.view, "resume");
      await this.dependencies.resources?.controlRun?.(id, "resume");
      await this.dependencies.remoteExecution?.resume(active.view);
      planPauseGate(id).resume();
      this.dependencies.resources?.resumeRun(id);
    });
    await this.dependencies.pump();
  }

  private async pausedView(active: ActivePlanRun): Promise<AgentPlanRun> {
    const stored = await this.dependencies.runs.find(active.view.id);
    if (!stored) throw new AgentError("plan_run_unavailable");
    const current = readPlanRun(stored);
    if (current.status !== "paused" || current.stopRequested)
      throw new AgentError("plan_run_unavailable");
    const previous = readPlanRun(active.view);
    if (
      current.id !== previous.id ||
      current.userId !== previous.userId ||
      current.planId !== previous.planId ||
      current.planRevision !== previous.planRevision ||
      current.continuation?.version !== previous.continuation?.version ||
      JSON.stringify(current.pauseBoundary) !==
        JSON.stringify(previous.pauseBoundary) ||
      !hasSamePausedWork(previous, current)
    )
      throw new AgentError("plan_context_changed");
    // Preflight access and Runner observations are durable even when no child was dispatched.
    return current;
  }

  private async adoptContinuation(
    active: ActivePlanRun,
    next: ReturnType<typeof preparePlanContinuation>,
    previous: AgentPlanRun,
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    const release = await this.dependencies.files?.hold(
      next.snapshot.steps.map((step) => step.step.agentId),
    );
    try {
      await this.dependencies.runs.update(
        next.run,
        undefined,
        {
          previous,
          snapshot: next.snapshot,
          workspaceIds: planWritingWorkspaces(next.snapshot),
        },
        journal,
      );
    } catch (error: unknown) {
      await release?.();
      throw error;
    }
    const previousRelease = active.releaseDefinition;
    active.releaseDefinition = async () => {
      await previousRelease?.();
      await release?.();
    };
  }

  private schedulePump(): void {
    void this.dependencies.pump().catch((error: unknown) => {
      logCaughtError("AgentPlanRunCommands", error);
    });
  }
}

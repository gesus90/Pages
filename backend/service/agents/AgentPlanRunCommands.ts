import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import {
  logCaughtError,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import { requestCancellation } from "./AgentPlanRunState";
import {
  preparePlanContinuation,
  planWritingWorkspaces,
} from "./AgentPlanContinuation";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRun } from "@/definition/AgentPlan";
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

/** Serial durable run commands; execution gates change only after the state and journal commit. */
export class AgentPlanRunCommands {
  private readonly dependencies: CommandDependencies;

  public constructor(dependencies: CommandDependencies) {
    this.dependencies = dependencies;
  }

  /** Journals a stop before cancelling owned executions. */
  public async stop(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    withLogContext({ runId: id }, () =>
      logEvent({
        level: "info",
        event: "agent.run.stop_requested",
        component: "AgentPlanRunEngine",
        message: "Agent plan stop requested",
      }),
    );
    await this.dependencies.writes.run(async () => {
      const active = this.dependencies.active.get(id);
      if (!active) {
        const run = await this.dependencies.runs.find(id);
        if (journal && run)
          await this.dependencies.runs.update(
            run,
            undefined,
            undefined,
            journal,
          );
        return;
      }
      const previous = structuredClone(active.view);
      try {
        requestCancellation(active);
        await this.dependencies.runs.update(
          active.view,
          undefined,
          undefined,
          journal,
        );
      } catch (error: unknown) {
        active.view = previous;
        throw error;
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
        !active ||
        active.view.stopRequested ||
        active.view.status !== "running"
      )
        throw new AgentError("plan_run_unavailable");
      const proposed: AgentPlanRun = {
        ...active.view,
        status: "pausing",
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
      for (const [stepId, controller] of active.controllers)
        if (!active.dispatched.has(stepId))
          controller.abort(new AgentPlanPausedError());
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
        active.view.status !== "paused" ||
        active.controllers.size !== 0
      )
        throw new AgentError("plan_run_unavailable");
      const proposed = snapshot ?? active.snapshot;
      const next = preparePlanContinuation(
        active.view,
        active.snapshot,
        proposed,
      );
      await this.adoptContinuation(active, next, journal);
      active.snapshot = next.snapshot;
      active.view = next.run;
      this.dependencies.steps.revise?.(id);
      this.dependencies.resources?.resumeRun(id);
    });
    await this.dependencies.pump();
  }

  private async adoptContinuation(
    active: ActivePlanRun,
    next: ReturnType<typeof preparePlanContinuation>,
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
          previous: active.view,
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

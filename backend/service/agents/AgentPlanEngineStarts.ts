import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { PlanStartFence } from "./AgentPlanStartResources";
import type { AgentPlanResourceStart } from "@/definition/AgentPlanResourceRelease";

interface EngineStartContext {
  readonly dependencies: EngineDependencies;
  readonly active: Map<string, ActivePlanRun>;
  readonly writes: SerialQueue;
  readonly reset: PlanStartFence;
}

/** Serializes fresh starts and fences replaced schedulers before process cleanup and resource reservation. */
export class AgentPlanEngineStarts {
  private readonly context: EngineStartContext;
  private readonly queue = new SerialQueue();

  public constructor(context: EngineStartContext) {
    this.context = context;
  }

  /** Runs a fresh start's cleanup and admission in the same engine queue. */
  public run(run: AgentPlanRun, snapshot: AgentPlanSnapshot, launch: (run: AgentPlanRun) => Promise<AgentPlanRun>): Promise<AgentPlanRun> {
    return this.queue.run(async () => {
      const warnings = run.origin?.kind === "resume" ? [] : await this.release(run, snapshot);
      return launch(warnings.length ? { ...run, startCleanupUnconfirmed: warnings } : run);
    });
  }

  /** Completes native cleanup for a separate API producer before it admits the prepared run. */
  public prepare(start: AgentPlanResourceStart, keys: readonly string[]): Promise<readonly string[]> {
    return this.queue.run(async () => await this.context.dependencies.startResources?.releaseResources(
      start, keys, (id, record) => this.retire(id, record),
    ) ?? []);
  }

  /** Applies durable retirements before consuming queued start commands. */
  public async reconcile(): Promise<void> {
    for (const id of this.context.active.keys()) {
      const stored = await this.context.dependencies.runs.find(id);
      if (!stored?.stopRequested || !["cancelled", "failed"].includes(stored.status)) continue;
      if (stored.resourceReleases?.length) {
        await this.retire(id, () => Promise.resolve(stored));
        await this.context.dependencies.startResources?.reconcile(stored);
      } else await this.context.reset(id, () => Promise.resolve(stored));
    }
  }

  private async release(run: AgentPlanRun, snapshot: AgentPlanSnapshot): Promise<readonly string[]> {
    return await this.context.dependencies.startResources?.release(run, snapshot, (id, record) => this.retire(id, record)) ?? [];
  }

  private async retire(id: string, record: () => Promise<AgentPlanRun>): Promise<void> {
    await this.context.writes.run(async () => {
      const retired = await record();
      const active = this.context.active.get(id);
      if (!active) return;
      active.view = retired;
      active.hasPersistenceFailure = true;
      for (const controller of active.controllers.values()) controller.abort();
      this.context.active.delete(id);
      try {
        await active.releaseDefinition?.();
      } catch (error: unknown) {
        logCaughtError("AgentPlanEngineStarts", error);
      }
    });
  }
}

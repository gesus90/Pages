import { logCaughtError } from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { hasNoSessionProcesses } from "./AgentPlanRecovery";

import type { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";
import type { AgentPlanRunEngine } from "./AgentPlanRunEngine";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";

interface CleanupDependencies {
  readonly obligations: AgentWorkspaceCleanupRepository;
  readonly runs: AgentPlanRunRepository;
  readonly engine: AgentPlanRunEngine;
  readonly remote: AgentPlanRemoteExecution;
}

/** Reconciles only jobs retained by an authorized metadata removal, independently of Runner availability. */
export class AgentWorkspaceCleanupService {
  private readonly dependencies: CleanupDependencies;
  private isBusy = false;

  public constructor(dependencies: CleanupDependencies) {
    this.dependencies = dependencies;
  }

  /** Restores durable work at startup and retries offline obligations without blocking logical deletion. */
  public start(): void {
    const timer = setInterval(() => void this.reconcile(), 2000);
    timer.unref();
    registerShutdownTask(() => {
      clearInterval(timer);
      return Promise.resolve();
    });
    void this.reconcile();
  }

  private async reconcile(): Promise<void> {
    if (this.isBusy) return;
    this.isBusy = true;
    try {
      for (const entry of await this.dependencies.obligations.pending()) {
        try {
          await this.settle(entry);
        } catch (error: unknown) {
          logCaughtError("AgentWorkspaceCleanupService", error);
          await this.dependencies.obligations.record(
            entry,
            "pending",
            "cleanup_check_failed",
          );
        }
      }
    } catch (error: unknown) {
      logCaughtError("AgentWorkspaceCleanupService", error);
    } finally {
      this.isBusy = false;
    }
  }

  private async settle(entry: AgentWorkspaceCleanup): Promise<void> {
    const { runs, engine, remote, obligations } = this.dependencies;
    const run = await runs.find(entry.runId);
    if (!run || run.userId !== entry.ownerId) {
      await obligations.record(entry, "pending", "owner_evidence_unavailable");
      return;
    }
    if (!run.stopRequested || isActivePlanRun(run.status))
      await engine.stop(run.id);
    await remote.stop(run);
    const current = await runs.find(run.id);
    if (!current) return;
    if (
      !engine.isActive(run.id) &&
      !isActivePlanRun(current.status) &&
      (await hasNoSessionProcesses(current))
    ) {
      await runs.release(run.id);
      await obligations.record(
        entry,
        "completed",
        "process_free_files_preserved",
      );
      return;
    }
    const progress = await remote.withProgress(current);
    const steps = allPlanRunResults(progress);
    const failure = steps.find((step) => step.remote?.cancellation?.failure)
      ?.remote?.cancellation?.failure;
    const isOffline = steps.some(
      (step) => step.remote?.contact?.state === "lost",
    );
    await obligations.record(
      entry,
      "pending",
      failure ?? (isOffline ? "runner_offline" : "process_end_unconfirmed"),
    );
  }
}

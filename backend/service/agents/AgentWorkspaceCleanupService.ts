import { logCaughtError } from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { checkSessionProcesses } from "./AgentPlanRecovery";
import {
  closeRecoverySessions,
  closeRecoveryScripts,
} from "./recovery/AgentPlanRecoveryScripts";

import type { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";
import type { PlanRunEnginePort } from "./runs/PlanRunEnginePort";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";

interface CleanupDependencies {
  readonly obligations: AgentWorkspaceCleanupRepository;
  readonly runs: Pick<AgentPlanRunRepository, "find" | "release">;
  readonly engine: Pick<PlanRunEnginePort, "stop" | "isActive">;
  readonly remote: Pick<AgentPlanRemoteExecution, "stop" | "withProgress">;
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
    registerShutdownTask(
      () => {
        clearInterval(timer);
        return Promise.resolve();
      },
      { step: "workspace_cleanup" },
    );
    void this.dependencies.obligations
      .resetAtStartup()
      .then(() => this.reconcile())
      .catch((error: unknown) => {
        logCaughtError("AgentWorkspaceCleanupService", error);
      });
  }

  /** Checks only due obligations; concurrent timer ticks share this pass. */
  public async reconcile(): Promise<void> {
    if (this.isBusy) return;
    this.isBusy = true;
    try {
      const runs = new Map<string, AgentPlanRun | null>();
      for (const entry of await this.dependencies.obligations.pending())
        await this.reconcileEntry(entry, runs);
    } catch (error: unknown) {
      logCaughtError("AgentWorkspaceCleanupService", error);
    } finally {
      this.isBusy = false;
    }
  }

  private async reconcileEntry(
    entry: AgentWorkspaceCleanup,
    runs: Map<string, AgentPlanRun | null>,
  ): Promise<void> {
    try {
      if (!runs.has(entry.runId))
        runs.set(entry.runId, await this.dependencies.runs.find(entry.runId));
      await this.settle(entry, runs.get(entry.runId) ?? null);
    } catch (error: unknown) {
      logCaughtError("AgentWorkspaceCleanupService", error);
      await this.dependencies.obligations.failedAttempt(
        entry,
        "cleanup_check_failed",
      );
    }
  }

  private async settle(
    entry: AgentWorkspaceCleanup,
    run: AgentPlanRun | null,
  ): Promise<void> {
    const { runs, engine, remote, obligations } = this.dependencies;
    if (!run || run.userId !== entry.ownerId) {
      await obligations.failedAttempt(entry, "owner_evidence_unavailable");
      return;
    }
    await this.requestStop(entry, run);
    if ((await engine.isActive(run.id)) || isActivePlanRun(run.status)) {
      await obligations.failedAttempt(entry, "process_end_unconfirmed");
      return;
    }
    const progress = allPlanRunResults(run).some((step) => step.remote)
      ? await remote.withProgress(run)
      : run;
    const checked = await closeRecoverySessions(
      await closeRecoveryScripts(progress),
    );
    const processes = await checkSessionProcesses(checked);
    if (processes.confirmed) {
      await runs.release(run.id);
      await obligations.record(
        entry,
        "completed",
        "process_free_files_preserved",
      );
      return;
    }
    await obligations.failedAttempt(
      entry,
      this.blockerFor(progress, Boolean(processes.failure)),
    );
  }

  private async requestStop(
    entry: AgentWorkspaceCleanup,
    run: AgentPlanRun,
  ): Promise<void> {
    const { engine, remote, obligations } = this.dependencies;
    if (!(await obligations.claimStop(entry))) return;
    if (!run.stopRequested || isActivePlanRun(run.status))
      await engine.stop(run.id);
    if (allPlanRunResults(run).some((step) => step.remote))
      await remote.stop(run);
  }

  private blockerFor(progress: AgentPlanRun, scanFailed: boolean): string {
    const steps = allPlanRunResults(progress);
    const failure = steps.find((step) => step.remote?.cancellation?.failure)
      ?.remote?.cancellation?.failure;
    if (failure) return failure;
    if (scanFailed) return "process_scan_unavailable";
    if (steps.some((step) => step.remote?.contact?.state === "lost"))
      return "runner_offline";
    return "process_end_unconfirmed";
  }
}

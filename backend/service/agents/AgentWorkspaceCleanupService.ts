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
      for (const entry of await this.dependencies.obligations.pending()) {
        try {
          if (!runs.has(entry.runId))
            runs.set(
              entry.runId,
              await this.dependencies.runs.find(entry.runId),
            );
          await this.settle(entry, runs.get(entry.runId) ?? null);
        } catch (error: unknown) {
          logCaughtError("AgentWorkspaceCleanupService", error);
          await this.dependencies.obligations.failedAttempt(
            entry,
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

  private async settle(
    entry: AgentWorkspaceCleanup,
    run: AgentPlanRun | null,
  ): Promise<void> {
    const { runs, engine, remote, obligations } = this.dependencies;
    if (!run || run.userId !== entry.ownerId) {
      await obligations.failedAttempt(entry, "owner_evidence_unavailable");
      return;
    }
    if (await obligations.claimStop(entry)) {
      if (!run.stopRequested || isActivePlanRun(run.status))
        await engine.stop(run.id);
      if (allPlanRunResults(run).some((step) => step.remote))
        await remote.stop(run);
    }
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
    const steps = allPlanRunResults(progress);
    const failure = steps.find((step) => step.remote?.cancellation?.failure)
      ?.remote?.cancellation?.failure;
    const isOffline = steps.some(
      (step) => step.remote?.contact?.state === "lost",
    );
    let blocker = failure ?? "process_end_unconfirmed";
    if (!failure && isOffline) blocker = "runner_offline";
    if (!failure && processes.failure) blocker = "process_scan_unavailable";
    await obligations.failedAttempt(entry, blocker);
  }
}

import { withoutReadScope } from "@/backend/database/ReadScope";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { logCaughtError } from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { PLAN_LOCK_WARNING_AGE_MS } from "@/definition/AgentPlanWorkspaceLock";

import {
  hasEndedWriter,
  hasNoLeaseWriter,
  hasNoPlanWriters,
} from "./AgentPlanWriterProcesses";
import {
  expandedPlanWriteResources,
  planWriterResourcesCollide,
} from "./AgentPlanWriterResources";
import { sharedAgentPlanRunObservers } from "./AgentPlanRunObservers";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanWorkspaceLockRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceLockRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanWorkspaceLock } from "@/definition/AgentPlanWorkspaceLock";
import type { AcpResourceScheduler } from "./AcpResourceScheduler";
import type { PlanRunEnginePort } from "./runs/PlanRunEnginePort";

interface LockDependencies {
  readonly repository: AgentPlanWorkspaceLockRepository;
  readonly resources: Pick<AcpResourceScheduler, "checkEndedLeases">;
  readonly engine: Pick<PlanRunEnginePort, "isActive">;
}

function lockReason(run: AgentPlanRun): AgentPlanWorkspaceLock["reason"] {
  if (isActivePlanRun(run.status)) return "active";
  if (run.status === "failed" || run.status === "work_done_closeout_open")
    return "resumable";
  return "cleanup";
}

/** One release path for an explicit UI decision and automatic end/startup reconciliation. */
export class AgentPlanWorkspaceLocks {
  private readonly dependencies: LockDependencies;
  private running: Promise<void> | null = null;

  public constructor(dependencies: LockDependencies) {
    this.dependencies = dependencies;
  }

  /** Starts after recovery, then checks periodically and after committed terminal progress. */
  public async start(): Promise<void> {
    await this.reconcile();
    const removeObserver = sharedAgentPlanRunObservers().add({
      runChanged: (previous, next) => {
        void previous;
        if (next.status === "succeeded" || next.status === "cancelled")
          setImmediate(() => void withoutReadScope(() => this.reconcile()));
      },
    });
    const timer = setInterval(() => void this.reconcile(), 30_000);
    timer.unref();
    registerShutdownTask(
      async () => {
        clearInterval(timer);
        removeObserver();
        await this.running;
      },
      { step: "plan_workspace_locks" },
    );
  }

  /** Releases only non-continuable ended runs; a failed or closeout-open run keeps its reservation. */
  public reconcile(): Promise<void> {
    this.running ??= withBackgroundDatabaseWork(
      "plan_workspace_locks",
      async () => {
        try {
          await this.dependencies.resources.checkEndedLeases();
          const owners = await this.dependencies.repository.list();
          const runs = new Map(
            owners.map((entry) => [entry.run.id, entry.run]),
          );
          for (const run of runs.values()) {
            if (run.status !== "succeeded" && run.status !== "cancelled")
              continue;
            await this.releaseEnded(run);
          }
        } catch (error: unknown) {
          logCaughtError("AgentPlanWorkspaceLocks", error);
        }
      },
    ).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Safe public metadata; callers authorize each holder before exposing its identifier. */
  public async views(
    planId: string,
    resources: readonly string[],
    permission: (run: AgentPlanRun) => Promise<boolean | null>,
  ): Promise<readonly AgentPlanWorkspaceLock[]> {
    const entries = await this.dependencies.repository.list();
    const keys = await expandedPlanWriteResources(resources);
    const grouped = new Map<string, (typeof entries)[number]>();
    for (const entry of entries) {
      const isRelated =
        entry.run.planId === planId ||
        keys.some((key) => planWriterResourcesCollide(entry.resource, key));
      if (isRelated && !grouped.has(entry.run.id))
        grouped.set(entry.run.id, entry);
    }
    const views: AgentPlanWorkspaceLock[] = [];
    for (const { run, acquiredAt } of grouped.values()) {
      const canRelease = await permission(run);
      if (canRelease === null) continue;
      const isActive = isActivePlanRun(run.status);
      const isResumable =
        run.status === "failed" || run.status === "work_done_closeout_open";
      const ageMilliseconds = Math.max(0, Date.now() - Date.parse(acquiredAt));
      views.push({
        runId: run.id,
        status: run.status,
        acquiredAt,
        ageMilliseconds,
        reason: lockReason(run),
        isOverdue: isResumable && ageMilliseconds >= PLAN_LOCK_WARNING_AGE_MS,
        canRelease: !isActive && canRelease,
      });
    }
    return views;
  }

  /** Refuses live writers without stopping them, then rechecks ownership inside the transaction. */
  public async release(
    run: AgentPlanRun,
    reason = "user_requested",
    journal?: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<void> {
    if (
      isActivePlanRun(run.status) ||
      (await this.dependencies.engine.isActive(run.id))
    )
      throw new AgentPlanRecoveryError("action_unavailable");
    await this.dependencies.resources.checkEndedLeases();
    await this.dependencies.repository.release(
      run,
      async (transaction) => {
        const ended = await this.releaseNativeOwners(transaction, run.id);
        const leases = await this.dependencies.repository.leases(
          transaction,
          run.id,
        );
        for (const lease of leases) {
          if (!(await hasNoLeaseWriter(lease)))
            throw new AgentPlanRecoveryError("cleanup_unconfirmed");
          await this.dependencies.repository.releaseLease(transaction, lease);
          ended.add(lease.instanceId);
        }
        // Prepare can persist its lease before the step received that process identity.
        if (!(await hasNoPlanWriters(run, ended)))
          throw new AgentPlanRecoveryError("cleanup_unconfirmed");
      },
      reason,
      journal,
    );
  }

  private async releaseEnded(run: AgentPlanRun): Promise<void> {
    try {
      await this.release(run, "ended_resources_settled");
    } catch (error: unknown) {
      if (!(error instanceof AgentPlanRecoveryError))
        logCaughtError("AgentPlanWorkspaceLocks", error);
    }
  }

  private async releaseNativeOwners(
    transaction: DatabaseTransaction,
    runId: string,
  ): Promise<Set<string>> {
    const ended = new Set<string>();
    const owners = await this.dependencies.repository.owners(
      transaction,
      runId,
    );
    for (const owner of owners) {
      if (!owner.proof || !(await hasEndedWriter(owner.proof)))
        throw new AgentPlanRecoveryError("cleanup_unconfirmed");
      await this.dependencies.repository.releaseOwner(
        transaction,
        owner.instanceId,
      );
      ended.add(owner.instanceId);
    }
    return ended;
  }
}

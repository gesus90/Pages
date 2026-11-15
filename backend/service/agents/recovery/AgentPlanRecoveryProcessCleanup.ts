import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { logCaughtError } from "@/backend/logging/Logger";
import { needsNoSessionScan } from "../AgentPlanRecovery";
import { cleanupScanFailure } from "../AgentPlanCleanupFailure";

import type { readScopeSince } from "@/backend/agents/cli/CliProcessScan";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AcpResourceScheduler } from "../AcpResourceScheduler";
import type { AgentPlanRemoteExecution } from "../AgentPlanRemoteExecution";

/** The boundaries that prove the processes, sessions and leases of a run have ended. */
export interface RecoveryCleanupDependencies {
  readonly remoteExecution?: Pick<AgentPlanRemoteExecution, "stop">;
  /** Rechecks the ACP leases of the run; absent without native capacity journal. */
  readonly resources?: Pick<AcpResourceScheduler, "reconcile" | "snapshot"> &
    Partial<Pick<AcpResourceScheduler, "releaseForResume">>;
}

/**
 * Ends the processes of a stopped or disturbed run and proves that none remain.
 *
 * @remarks
 * Recovery actions call these checks before anything starts again or any
 * working copy and lease is released. Failures are reported as
 * `cleanup_unconfirmed`, never assumed away.
 */
export class AgentPlanRecoveryProcessCleanup {
  private readonly dependencies: RecoveryCleanupDependencies;

  public constructor(dependencies: RecoveryCleanupDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks the remote executor to stop when a remote closeout of the run is unconfirmed.
   *
   * @param run - The run whose remote results are checked.
   */
  public async requestRemoteCleanup(run: AgentPlanRun): Promise<void> {
    if (allPlanRunResults(run).some(isRemoteCloseoutUnconfirmed))
      await this.dependencies.remoteExecution?.stop(run);
  }

  /**
   * Ends every local session of the run that still owns a process.
   *
   * @param run - The run whose local sessions are ended.
   * @param scope - The process scan since the run started, or `null` when it failed.
   * @throws {AgentPlanRecoveryError} `cleanup_unconfirmed` while a process of
   * the run is still alive or cannot be ruled out.
   */
  public async endLocalProcesses(
    run: AgentPlanRun,
    scope: Awaited<ReturnType<typeof readScopeSince>> | null,
  ): Promise<void> {
    for (const step of allPlanRunResults(run)) {
      if (step.execution?.target.kind === "remote" || step.script) continue;
      const instanceId = step.session?.instanceId;
      const closeout = step.session?.closeout;
      if (instanceId === undefined || closeout === "confirmed") continue;
      const session = step.session;
      // A turn refused before its start owns no process; the record that opened a shared session accounts for it.
      if (session && needsNoSessionScan(session)) continue;
      const cleanup = await (
        session && session.runner !== "api" && session.namespace
          ? settleOwnedNamespace(session.namespace, instanceId).then(
              (ended) => ({
                remaining: ended ? 0 : 1,
              }),
            )
          : endTaggedProcesses(instanceId, scope)
      ).catch((caughtError: unknown) => {
        logCaughtError("AgentPlanRecoveryActions", caughtError);
        throw new AgentPlanRecoveryError(
          "cleanup_unconfirmed",
          cleanupScanFailure(step.id, "local_session", caughtError),
        );
      });
      if (cleanup.remaining > 0)
        throw new AgentPlanRecoveryError("cleanup_unconfirmed", {
          stepId: step.id,
          kind: "local_session",
          reason: "processes_remaining",
        });
    }
  }

  /**
   * Rechecks the ACP leases of the run and fails closed when any of them remains.
   *
   * @param runId - The run whose leases are checked.
   * @throws {AgentPlanRecoveryError} `cleanup_unconfirmed` while a lease of the
   * run remains or the scheduler cannot be read.
   */
  public async reconcileResources(runId: string): Promise<void> {
    const resources = this.dependencies.resources;
    if (!resources) return;
    try {
      const remaining = await resources.reconcile(runId);
      const state = resources.snapshot();
      if (
        remaining > 0 ||
        state.problem !== null ||
        state.active.some((entry) => entry.runId === runId)
      )
        throw new AgentPlanRecoveryError("cleanup_unconfirmed");
    } catch (error: unknown) {
      if (error instanceof AgentPlanRecoveryError) throw error;
      logCaughtError("AgentPlanRecoveryActions", error);
      throw new AgentPlanRecoveryError("cleanup_unconfirmed");
    }
  }
}

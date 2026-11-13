import { randomUUID } from "node:crypto";

import { logEvent, withLogContext } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { attemptPlanStartCleanup, cleanupPlanStartOwner } from "./AgentPlanStartCleanup";
import { planWritingWorkspaces } from "./AgentPlanContinuation";
import { sanitizeArtifactText } from "./AgentPlanOutput";

import type { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStartOwner, AgentPlanResourceRelease, AgentPlanResourceStart } from "@/definition/AgentPlanResourceRelease";
import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AcpResourceScheduler } from "./AcpResourceScheduler";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

interface StartResourceDependencies {
  readonly repository: Pick<AgentPlanStartResourceRepository, "conflicts" | "localOwners" | "retire" | "complete">;
  readonly remote?: Pick<AgentPlanRemoteExecution, "stop" | "withProgress">;
  readonly localSessions?: Pick<LocalSessions, "forgetForcedRun">;
  readonly resources?: Pick<AcpResourceScheduler, "forceReleaseRun">;
}

/** Fences an old scheduler under its write queue before cancelling any of its processes. */
export type PlanStartFence = (runId: string, record: () => Promise<AgentPlanRun>) => Promise<void>;

/** Reusable explicit-start takeover; uncertain process cleanup never retains writer ownership. */
export class AgentPlanStartResources {
  private readonly dependencies: StartResourceDependencies;

  public constructor(dependencies: StartResourceDependencies) {
    this.dependencies = dependencies;
  }

  /** Names active owners for the start dialog after the new plan's resources have been authorized. */
  public async owners(snapshot: AgentPlanSnapshot): Promise<readonly AgentPlanStartOwner[]> {
    const owners = await this.dependencies.repository.conflicts(snapshot.plan.id, planWritingWorkspaces(snapshot));
    return owners.filter((owner) => isActivePlanRun(owner.run.status)).map(({ run }) => ({
      runId: run.id, planName: sanitizeArtifactText(run.planName), startedAt: run.startedAt,
    }));
  }

  /** Retries physical cleanup when an unavailable elected owner reconnects after API-side forced admission. */
  public async reconcile(run: AgentPlanRun): Promise<void> {
    const release = run.resourceReleases?.at(-1);
    if (!release) return;
    const owners = release.processes.filter((entry) => entry.kind === "local_session").map((entry) => entry.instanceId);
    const processes = await cleanupPlanStartOwner(run, owners, this.dependencies.remote);
    const confirmed = await this.releaseRuntime(run.id) && processes.every((entry) => entry.confirmed);
    await this.dependencies.repository.complete(run.id, { ...release, processes: [...processes], confirmed }, { preserveRevision: true });
  }

  /** Retires every conflicting owner before the new run reserves any resource. */
  public async release(run: AgentPlanRun, snapshot: AgentPlanSnapshot, fence: PlanStartFence): Promise<readonly string[]> {
    return this.releaseResources({
      id: run.id, planId: run.planId, userId: run.userId,
      ...(run.origin?.kind === "restart" ? { sourceRunId: run.origin.runId } : {}),
    }, planWritingWorkspaces(snapshot), fence);
  }

  /** Performs the same takeover for an authorized API start without transferring its private snapshot. */
  public async releaseResources(run: AgentPlanResourceStart, keys: readonly string[], fence: PlanStartFence): Promise<readonly string[]> {
    const { repository } = this.dependencies;
    const owners = await repository.conflicts(run.planId, keys, run.sourceRunId);
    const warnings: string[] = [];
    for (const owner of owners) {
      if (owner.run.id === run.id) continue;
      const release: AgentPlanResourceRelease = {
        id: randomUUID(), userId: run.userId, targetRunId: run.id,
        createdAt: new Date().toISOString(), resources: [...owner.resources],
        processes: [], confirmed: false,
      };
      const options = { preserveRevision: run.sourceRunId === owner.run.id };
      const localOwners = await repository.localOwners(owner.run.id);
      await fence(owner.run.id, () => repository.retire(owner.run.id, release, options));
      const processes = await cleanupPlanStartOwner(owner.run, localOwners, this.dependencies.remote);
      let confirmed = processes.every((process) => process.confirmed);
      confirmed = await this.releaseRuntime(owner.run.id) && confirmed;
      await repository.complete(owner.run.id, { ...release, processes: [...processes], confirmed }, options);
      this.journalRelease(owner.run.id, { ...release, processes: [...processes], confirmed });
      if (!confirmed) warnings.push(owner.run.id);
    }
    return warnings;
  }

  private async releaseRuntime(runId: string): Promise<boolean> {
    const results = await Promise.all([
      attemptPlanStartCleanup(async () => { await this.dependencies.localSessions?.forgetForcedRun(runId); return true; }),
      attemptPlanStartCleanup(async () => await this.dependencies.resources?.forceReleaseRun(runId) ?? true),
    ]);
    return results.every(Boolean);
  }

  private journalRelease(runId: string, release: AgentPlanResourceRelease): void {
    const metadata = { userId: release.userId, origin: release.targetRunId, isConfirmed: release.confirmed };
    withLogContext({ runId }, () => {
      logEvent({
        level: release.confirmed ? "info" : "warn", event: "agent.run.resources_force_released",
        component: "AgentPlanStartResources", message: "A new start forcibly released this run's resources", metadata,
      });
      for (const resource of release.resources) logEvent({
        level: "info", event: "agent.run.resource_force_released", component: "AgentPlanStartResources",
        message: "Writing resource forcibly released", metadata: { ...metadata, reason: resource },
      });
      for (const process of release.processes) logEvent({
        level: process.confirmed ? "info" : "warn", event: "agent.run.process_force_ended", component: "AgentPlanStartResources",
        message: "Forced process cleanup attempted", metadata: { ...metadata, isConfirmed: process.confirmed,
          sessionId: process.instanceId, pid: process.processId, kind: process.kind },
      });
    });
  }
}

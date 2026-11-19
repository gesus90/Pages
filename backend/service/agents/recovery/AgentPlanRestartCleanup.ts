import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";

import { checkSessionProcesses } from "../AgentPlanRecovery";
import {
  closeRecoverySessions,
  closeRecoveryScripts,
} from "./AgentPlanRecoveryScripts";
import { cleanupPlanStartOwner } from "../AgentPlanStartCleanup";

import type { RecoveryActionDependencies } from "./AgentPlanRecoveryActions";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";

/** Retries each restart cleanup phase three times; no later phase runs after a final failure. */
export async function retryRestartCleanup<Result>(
  step: string,
  work: () => Promise<Result>,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error: unknown) {
      if (attempt < 3) continue;
      if (error instanceof AgentPlanRecoveryError && error.cleanupFailure)
        throw error;
      logCaughtError("AgentPlanRestartCleanup", error);
      throw new AgentPlanRecoveryError("cleanup_unconfirmed", {
        stepId: step,
        kind: "local_session",
        reason: "resource_cleanup_failed",
      });
    }
  }
}

/** Server-owned cleanup, before preparation or dispatch of the new run. */
export async function cleanupRestartSource(
  dependencies: RecoveryActionDependencies,
  run: AgentPlanRun,
): Promise<void> {
  const localOwners = await retryRestartCleanup(
    "owners",
    () =>
      dependencies.restartOwners?.localOwners(run.id) ?? Promise.resolve([]),
  );
  await retryRestartCleanup("stop", async () => {
    if (await dependencies.engine.isActive?.(run.id)) {
      await dependencies.engine.stop?.(run.id);
      if (await dependencies.engine.isActive?.(run.id))
        throw new AgentPlanRecoveryError("cleanup_unconfirmed", {
          stepId: "stop",
          kind: "local_session",
          reason: "engine_active",
        });
    }
  });
  const proven = await retryRestartCleanup(
    "leases",
    () =>
      dependencies.resources?.prepareRestart?.(run.id) ??
      Promise.resolve(new Set<string>()),
  );
  const hasProof = await retryRestartCleanup("evidence", () =>
    dependencies.executions.hasRestartProof(run),
  );
  await retryRestartCleanup("processes", () =>
    checkRestartProcesses(dependencies, run, { proven, localOwners, hasProof }),
  );
  await retryRestartCleanup("release_and_retire", async () => {
    const retire = (): Promise<void> =>
      dependencies.executions.retireForRestart(run);
    if (dependencies.resources?.releaseRestart) {
      await dependencies.resources.releaseRestart(run.id, proven, retire);
    } else await retire();
  });
}

interface RestartEvidence {
  readonly proven: ReadonlySet<string>;
  readonly localOwners: readonly string[];
  readonly hasProof: boolean;
}

async function checkRestartProcesses(
  dependencies: RecoveryActionDependencies,
  run: AgentPlanRun,
  evidence: RestartEvidence,
): Promise<void> {
  const { proven, localOwners, hasProof } = evidence;
  // A lease's verified boundary also proves its historical session ended.
  const checked = hasProof
    ? { ...run, steps: [], loops: [] }
    : withoutProvenRestartSessions(run, proven);
  const processes = await cleanupPlanStartOwner(
    checked,
    [],
    dependencies.remoteExecution,
  );
  const failure = processes.find((process) => !process.confirmed);
  if (failure)
    throw new AgentPlanRecoveryError("cleanup_unconfirmed", {
      stepId:
        allPlanRunResults(run).find(
          (step) =>
            (step.session?.instanceId ??
              step.script?.instanceId ??
              step.remote?.jobId) === failure.instanceId,
        )?.id ?? "processes",
      kind: failure.kind,
      reason: "processes_remaining",
    });
  const progress = dependencies.remoteExecution?.withProgress
    ? await dependencies.remoteExecution.withProgress(checked)
    : checked;
  const closed = await closeRecoverySessions(
    await closeRecoveryScripts(progress),
  );
  const processCheck = await checkSessionProcesses(closed);
  if (!processCheck.confirmed)
    throw new AgentPlanRecoveryError(
      "cleanup_unconfirmed",
      processCheck.failure ?? {
        stepId: "processes",
        kind: "local_session",
        reason: "processes_remaining",
      },
    );
  if (
    allPlanRunResults(run).some(isRemoteCloseoutUnconfirmed) &&
    !dependencies.remoteExecution
  )
    throw new Error("Remote cleanup unavailable");
  await settleRestartOwners(localOwners, proven);
}

async function settleRestartOwners(
  localOwners: readonly string[],
  proven: ReadonlySet<string>,
): Promise<void> {
  for (const instanceId of localOwners) {
    if (proven.has(instanceId)) continue;
    const settled = await settleManagedLocalOwner(instanceId);
    if (settled !== true) {
      logEvent({
        level: "warn",
        event: "agent.restart.local_owner_unconfirmed",
        component: "AgentPlanRestartCleanup",
        message: "Recorded local owner settlement was not confirmed",
        metadata: {
          reason:
            settled === null ? "owner_unavailable" : "cleanup_unconfirmed",
        },
      });
      throw new Error(
        settled === null
          ? "Local owner settlement unavailable for recorded owner"
          : "Local owner cleanup was not confirmed",
      );
    }
  }
}

/** Ownership records may include sessions that never reached a step's history. */
export type RestartOwners = Pick<
  AgentPlanStartResourceRepository,
  "localOwners"
>;

function withoutProvenRestartSessions(
  run: AgentPlanRun,
  proven: ReadonlySet<string>,
): AgentPlanRun {
  const checkStep = (step: AgentPlanStepResult): AgentPlanStepResult =>
    step.session && proven.has(step.session.instanceId)
      ? { ...step, session: null }
      : step;
  const loops = run.loops?.map((loop) => {
    const sessions = loop.sessions.filter(
      (session) =>
        session.instanceId === null || !proven.has(session.instanceId),
    );
    const areAllProven = loop.sessions.length > 0 && sessions.length === 0;
    return {
      ...loop,
      sessions,
      cleanup: areAllProven ? ("confirmed" as const) : loop.cleanup,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(checkStep),
      })),
    };
  });
  return {
    ...run,
    steps: run.steps.map(checkStep),
    ...(loops ? { loops } : {}),
  };
}

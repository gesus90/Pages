import {
  endTaggedProcesses,
  findTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import {
  allPlanRunResults,
  hasUnconfirmedLoopCloseout,
} from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { logCaughtError } from "@/backend/logging/Logger";

import { endInterruptedScript } from "./AgentPlanScriptRecovery";
import { cleanupScanFailure } from "./AgentPlanCleanupFailure";

import type { TaggedProcessScope } from "@/backend/agents/cli/CliProcessScan";
import type { AcpResourceOwner } from "@/definition/AcpResource";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

/** No session of a run started before the run. */
async function runScope(
  runStartedAt: string,
): Promise<TaggedProcessScope | null> {
  try {
    return await readScopeSince(runStartedAt);
  } catch (caughtError: unknown) {
    logCaughtError("AgentPlanRecovery", caughtError);

    // Without a readable start the scan stays unbounded, and therefore strict.
    return null;
  }
}

/**
 * Ends what an interrupted node left behind: its processes and its MCP access.
 *
 * @param step - The node of the interrupted run.
 * @param runStartedAt - When its run began, before any of its sessions.
 *
 * @remarks
 * A server stop can leave a runner and its helpers running in their own
 * process group. Every process of a session carries its instance tag, so the
 * restarted server finds and ends them before it reports the node as failed.
 * Unreadable processes of this account that started before the run, such as
 * its service manager, cannot carry the tag.
 */
export async function endInterruptedSession(
  step: AgentPlanStepResult,
  runStartedAt: string,
): Promise<AgentPlanStepResult> {
  if (step.execution?.target.kind === "remote") return step;
  if (step.script) return endInterruptedScript(step);
  const session = step.session;
  if (!session || session.closeout !== "pending") return step;
  const cleanup = await endTaggedProcesses(
    session.instanceId,
    await runScope(runStartedAt),
  ).catch((cleanupError: unknown) => {
    logCaughtError("AgentPlanRecovery", cleanupError);
    return { found: 0, remaining: 1 };
  });
  return {
    ...step,
    session: {
      ...session,
      endedAt: new Date().toISOString(),
      closeout: cleanup.remaining === 0 ? "confirmed" : "failed",
      leftoverProcesses: cleanup.found,
      resultCode: -1,
    },
  };
}

/**
 * Whether each attempt's closeout is confirmed or unnecessary and no session process remains.
 *
 * @remarks
 * A node stores its session record before its runner starts, so a node
 * without one never started a process. The start of the run bounds the scan
 * like that of {@link endInterruptedSession}.
 */
export async function hasNoSessionProcesses(
  run: AgentPlanRun,
): Promise<boolean> {
  return (await checkSessionProcesses(run)).confirmed;
}

/** Checks recorded closeouts and identifies a failed owned process scan. */
export async function checkSessionProcesses(run: AgentPlanRun): Promise<{
  readonly confirmed: boolean;
  readonly failure: AgentPlanCleanupFailure | null;
}> {
  if (
    hasUnconfirmedLoopCloseout(run) ||
    allPlanRunResults(run).some(
      (step) =>
        isRemoteCloseoutUnconfirmed(step) ||
        (step.session !== undefined &&
          step.session !== null &&
          step.session.closeout !== "confirmed" &&
          step.session.closeout !== "not_needed") ||
        (step.script !== undefined && step.script.closeout !== "confirmed"),
    )
  )
    return { confirmed: false, failure: null };
  const scope = await runScope(run.startedAt);
  const instances = processInstances(run);
  const scans = await Promise.all(
    [...instances].map(([id, resource]) => scanInstance(id, resource, scope)),
  );
  const failure = scans.find((scan) => scan !== null) ?? null;
  return { confirmed: failure === null, failure };
}

function processInstances(
  run: AgentPlanRun,
): Map<string, Pick<AgentPlanCleanupFailure, "stepId" | "kind">> {
  const instances = new Map<
    string,
    Pick<AgentPlanCleanupFailure, "stepId" | "kind">
  >();
  for (const step of allPlanRunResults(run)) {
    if (step.execution?.target.kind === "remote") continue;
    if (step.session?.instanceId)
      instances.set(step.session.instanceId, {
        stepId: step.id,
        kind: "local_session",
      });
    if (step.script?.instanceId)
      instances.set(step.script.instanceId, {
        stepId: step.id,
        kind: "local_script",
      });
  }
  for (const loop of run.loops ?? [])
    for (const session of loop.sessions)
      if (session.instanceId)
        instances.set(session.instanceId, { stepId: loop.id, kind: "loop" });
  return instances;
}

async function scanInstance(
  id: string,
  resource: Pick<AgentPlanCleanupFailure, "stepId" | "kind">,
  scope: TaggedProcessScope | null,
): Promise<AgentPlanCleanupFailure | null> {
  try {
    const processes = await findTaggedProcesses(id, scope);
    return processes.length === 0
      ? null
      : { ...resource, reason: "processes_remaining" };
  } catch (caughtError: unknown) {
    logCaughtError("AgentPlanRecovery", caughtError);
    return cleanupScanFailure(resource.stepId, resource.kind, caughtError);
  }
}

/** Adopts older interrupted sessions that predate the durable ACP capacity journal. */
export function interruptedAcpOwners(
  runs: readonly AgentPlanRun[],
): readonly AcpResourceOwner[] {
  return runs.flatMap((run) =>
    allPlanRunResults(run).flatMap((step) => {
      const session = step.session;
      if (
        !session ||
        (session.closeout !== "pending" && session.closeout !== "failed") ||
        session.runner === "api" ||
        !isAcpProvider(session.runner) ||
        session.mode !== "interactive"
      )
        return [];
      return [
        {
          instanceId: session.instanceId,
          userId: run.userId,
          provider: session.runner,
          runId: run.id,
          stepId: step.id,
        },
      ];
    }),
  );
}

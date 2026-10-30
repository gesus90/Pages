import {
  endTaggedProcesses,
  findTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import {
  allPlanRunResults,
  hasUnconfirmedLoopCloseout,
} from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { logCaughtError } from "@/backend/logging/Logger";

import { endInterruptedScript } from "./AgentPlanScriptRecovery";
import { cleanupScanFailure } from "./AgentPlanCleanupFailure";

import type { TaggedProcessScope } from "@/backend/agents/cli/CliProcessScan";
import type {
  AcpNamespaceOwner,
  AcpResourceOwner,
} from "@/definition/AcpResource";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
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
 * A stored namespace supervisor proves the boundary of new sessions. Older
 * records without such proof remain unconfirmed after a restart; a tag or
 * process ancestry alone cannot account for detached helpers.
 */
export async function endInterruptedSession(
  step: AgentPlanStepResult,
  runStartedAt: string,
): Promise<AgentPlanStepResult> {
  if (step.execution?.target.kind === "remote") return step;
  if (step.script) return endInterruptedScript(step);
  const session = step.session;
  if (!session || !needsSettlement(session)) return step;
  const cleanup = await settleSession(session, runStartedAt);
  const isContained = cleanup.remaining === 0 && ownsNamespace(session);
  return {
    ...step,
    session: {
      ...session,
      endedAt: new Date().toISOString(),
      closeout: cleanup.remaining === 0 ? "confirmed" : "failed",
      ...(isContained ? { containment: "pid_namespace" as const } : {}),
      leftoverProcesses: cleanup.found,
      resultCode: -1,
    },
  };
}

type OwnedNamespaceSession = AgentPlanSessionRecord & {
  readonly namespace: AcpNamespaceOwner;
};

function ownsNamespace(
  session: AgentPlanSessionRecord,
): session is OwnedNamespaceSession {
  return session.runner !== "api" && session.namespace !== undefined;
}

/** A failed closeout is only retried where a recorded namespace can prove the end. */
function needsSettlement(session: AgentPlanSessionRecord): boolean {
  if (session.closeout === "pending") return true;
  return session.closeout === "failed" && ownsNamespace(session);
}

async function settleSession(
  session: AgentPlanSessionRecord,
  runStartedAt: string,
): Promise<{ readonly found: number; readonly remaining: number }> {
  try {
    if (ownsNamespace(session)) {
      const hasEnded = await settleOwnedNamespace(
        session.namespace,
        session.instanceId,
      );
      return { found: 0, remaining: hasEnded ? 0 : 1 };
    }
    return await endTaggedProcesses(
      session.instanceId,
      await runScope(runStartedAt),
    );
  } catch (cleanupError: unknown) {
    logCaughtError("AgentPlanRecovery", cleanupError);
    return { found: 0, remaining: 1 };
  }
}

/**
 * Whether each attempt's closeout is confirmed or unnecessary and no session process remains.
 *
 * @remarks
 * A node stores its session record before its runner starts. Confirmed owned
 * namespaces need no host-wide process discovery; legacy records fail closed.
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
  const contained = new Set<string>();
  for (const step of allPlanRunResults(run)) {
    if (step.execution?.target.kind === "remote") continue;
    if (step.session && hasContainedSession(step.session))
      contained.add(step.session.instanceId);
    if (step.session?.instanceId && !needsNoSessionScan(step.session))
      instances.set(step.session.instanceId, {
        stepId: step.id,
        kind: "local_session",
      });
    if (needsScriptScan(step))
      instances.set(step.script.instanceId, {
        stepId: step.id,
        kind: "local_script",
      });
  }
  for (const loop of run.loops ?? [])
    for (const session of loop.sessions)
      if (session.instanceId && !contained.has(session.instanceId))
        instances.set(session.instanceId, { stepId: loop.id, kind: "loop" });
  return instances;
}

function needsScriptScan(
  step: AgentPlanStepResult,
): step is AgentPlanStepResult & {
  readonly script: NonNullable<AgentPlanStepResult["script"]>;
} {
  return Boolean(
    step.script?.instanceId &&
    !(
      step.script.closeout === "confirmed" &&
      (step.script.namespace !== undefined || hasPreSpawnEndEvidence(step))
    ),
  );
}

/** A closed pre-start pause is not a user Stop; launched scripts drain instead of pausing. */
function hasPreSpawnEndEvidence(step: AgentPlanStepResult): boolean {
  return Boolean(
    step.script &&
    step.script.processId === null &&
    step.script.endedAt !== null &&
    (step.cancellation === "not_started" ||
      (step.status === "paused" && step.script.failure === null)),
  );
}

function hasContainedSession(session: AgentPlanSessionRecord): boolean {
  return (
    session.runner !== "api" &&
    session.closeout === "confirmed" &&
    session.containment === "pid_namespace"
  );
}

function needsNoSessionScan(session: AgentPlanSessionRecord): boolean {
  return (
    hasContainedSession(session) ||
    (session.runner === "api" &&
      session.mode === "request" &&
      session.processId === null &&
      session.closeout === "not_needed") ||
    (session.runner !== "api" &&
      session.closeout === "not_needed" &&
      session.processId === null)
  );
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

import { forceOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { logCaughtError } from "@/backend/logging/Logger";

import { endInterruptedSession } from "./AgentPlanRecovery";
import { endInterruptedScript } from "./AgentPlanScriptRecovery";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanReleasedProcess } from "@/definition/AgentPlanResourceRelease";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";

const START_CLEANUP_TIMEOUT_MILLISECONDS = 10_000;

/** A failed or unreachable owner is evidence for a hint, never a start gate. */
export async function attemptPlanStartCleanup(
  clean: () => Promise<boolean>,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      clean(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(
          () => resolve(false),
          START_CLEANUP_TIMEOUT_MILLISECONDS,
        );
      }),
    ]);
  } catch (error: unknown) {
    logCaughtError("AgentPlanStartCleanup", error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Uses the same owned session, script and runner boundaries as Recovery → Release. */
export async function cleanupPlanStartOwner(
  run: AgentPlanRun,
  localOwners: readonly string[],
  remote?: Pick<AgentPlanRemoteExecution, "stop" | "withProgress">,
): Promise<readonly AgentPlanReleasedProcess[]> {
  const steps = new Map<string, AgentPlanStepResult>();
  for (const step of allPlanRunResults(run)) {
    const identity =
      step.execution?.target.kind === "remote"
        ? (step.remote?.jobId ?? step.execution.attemptId)
        : (step.script?.instanceId ?? step.session?.instanceId);
    if (identity) steps.set(identity, step);
  }
  const cleanup = [...steps.values()].map(async (step) => {
    if (step.execution?.target.kind !== "remote")
      return localProcess(run, step);
    const attempt = { ...run, steps: [step], loops: undefined };
    return {
      instanceId: step.remote?.jobId ?? step.execution.attemptId,
      processId: null,
      kind: "remote_attempt" as const,
      confirmed: await attemptPlanStartCleanup(async () => {
        if (!remote) return false;
        await remote.stop(attempt);
        return !allPlanRunResults(await remote.withProgress(attempt)).some(
          isRemoteCloseoutUnconfirmed,
        );
      }),
    };
  });
  for (const instanceId of localOwners) {
    if (steps.has(instanceId)) continue;
    cleanup.push(
      (async () => ({
        instanceId,
        processId: null,
        kind: "local_session" as const,
        confirmed: await attemptPlanStartCleanup(
          async () => (await settleManagedLocalOwner(instanceId)) === true,
        ),
      }))(),
    );
  }
  return (await Promise.all(cleanup)).filter((entry) => entry !== null);
}

async function localProcess(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
): Promise<AgentPlanReleasedProcess | null> {
  const record = step.script ?? step.session;
  if (!record) return null;
  const confirmed = await attemptPlanStartCleanup(async () => {
    if (step.script) {
      if (step.script.namespace)
        if (
          !(await forceOwnedNamespace(step.script.namespace, record.instanceId))
        )
          return false;
      const checked = await endInterruptedScript(step);
      return checked.script?.closeout === "confirmed";
    }
    if (!step.session) return true;
    if (!step.session.namespace) {
      const managed = await settleManagedLocalOwner(record.instanceId);
      if (managed !== null)
        return (
          managed &&
          !run.resourceReleases?.some((release) =>
            release.processes.some(
              (process) =>
                process.instanceId === record.instanceId && !process.confirmed,
            ),
          )
        );
      if (record.closeout === "confirmed" || record.closeout === "not_needed")
        return true;
      return (await endTaggedProcesses(record.instanceId)).remaining === 0;
    }
    if (!(await forceOwnedNamespace(step.session.namespace, record.instanceId)))
      return false;
    const checked = await endInterruptedSession(
      { ...step, session: { ...step.session, closeout: "pending" } },
      run.startedAt,
    );
    return checked.session?.closeout === "confirmed";
  });
  return {
    instanceId: record.instanceId,
    processId: record.processId,
    kind: step.script ? "local_script" : "local_session",
    confirmed,
  };
}

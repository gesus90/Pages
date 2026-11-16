import {
  hasEndedOwnedNamespace,
  previousBootNamespaceState,
} from "@/backend/agents/cli/CliOwnedNamespace";
import {
  hasInactiveRecordedUnit,
  hasRunningWorkerUnit,
} from "@/backend/agents/cli/CliWorkerUnit";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";

import { startedBeforeBoot } from "./resources/AcpLeaseEvidence";
import { hasNoSessionProcesses } from "./AgentPlanRecovery";

import type {
  AcpNamespaceOwner,
  AcpResourceRecord,
} from "@/definition/AcpResource";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

/** Refuses a live PID, an active recorded unit or an unconfirmed process boundary. */
export async function hasEndedWriter(
  owner: AcpNamespaceOwner,
): Promise<boolean> {
  const previousBoot = await previousBootNamespaceState(owner);
  if (previousBoot === "alive") return false;
  if (!(await hasEndedOwnedNamespace(owner))) return false;
  return !owner.unit || (await hasInactiveRecordedUnit(owner.unit));
}

/** Proves an uncertain lease ended after the run's independent native owners have been checked. */
export async function hasNoLeaseWriter(
  lease: AcpResourceRecord,
): Promise<boolean> {
  if (lease.state !== "cleanup_failed") return false;
  if (lease.namespace && !(await hasEndedWriter(lease.namespace))) return false;
  if (lease.workerUnit && !(await hasInactiveRecordedUnit(lease.workerUnit)))
    return false;
  if (await hasRunningWorkerUnit(lease.instanceId)) return false;
  if (lease.namespace) return true;
  return (
    lease.lifecycle === "not_spawned" || (await startedBeforeBoot(lease.since))
  );
}

function checkedStep(
  step: AgentPlanStepResult,
  ended: ReadonlySet<string>,
): AgentPlanStepResult {
  return {
    ...step,
    ...(step.session && ended.has(step.session.instanceId)
      ? {
          session: {
            ...step.session,
            closeout: "confirmed" as const,
            containment: "pid_namespace" as const,
          },
        }
      : {}),
    ...(step.script && ended.has(step.script.instanceId)
      ? { script: { ...step.script, closeout: "confirmed" as const } }
      : {}),
  };
}

function checkedLoop(
  loop: AgentPlanLoopRun,
  ended: ReadonlySet<string>,
): AgentPlanLoopRun {
  const hasEnded = loop.sessions.every(
    (session) => session.instanceId && ended.has(session.instanceId),
  );
  return {
    ...loop,
    ...(hasEnded
      ? {
          cleanup: "confirmed" as const,
          sessions: loop.sessions.map((session) => ({
            ...session,
            state: "closed" as const,
            closeout: "confirmed" as const,
          })),
        }
      : {}),
    iterations: loop.iterations.map((iteration) => ({
      ...iteration,
      nodes: iteration.nodes.map((step) => checkedStep(step, ended)),
    })),
  };
}

/** Reads all recorded attempts, including loops, without stopping any of their processes. */
export async function hasNoPlanWriters(
  run: AgentPlanRun,
  provenEnded: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  const ended = new Set(provenEnded);
  for (const step of allPlanRunResults(run)) {
    if (!(await checkStepWriter(step, ended))) return false;
  }
  const checked: AgentPlanRun = {
    ...run,
    steps: run.steps.map((step) => checkedStep(step, ended)),
    ...(run.loops
      ? { loops: run.loops.map((loop) => checkedLoop(loop, ended)) }
      : {}),
  };
  return hasNoSessionProcesses(checked);
}

async function checkStepWriter(
  step: AgentPlanStepResult,
  ended: Set<string>,
): Promise<boolean> {
  if (isRemoteCloseoutUnconfirmed(step)) return false;
  if (step.execution?.target.kind === "remote") return true;
  const owner = step.script?.namespace ?? step.session?.namespace;
  if (!owner) return true;
  const instanceId = step.script?.instanceId ?? step.session?.instanceId;
  if (!(await hasEndedWriter(owner))) return false;
  if (instanceId && (await hasRunningWorkerUnit(instanceId))) return false;
  if (instanceId) ended.add(instanceId);
  return true;
}

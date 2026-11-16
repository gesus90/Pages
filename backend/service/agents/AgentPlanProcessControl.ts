import { controlOwnedNamespace } from "@/backend/agents/cli/CliNamespaceControl";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { controlOwnedScript } from "./AgentPlanScriptOwner";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";

/** Applies reversible process control to every owned agent and script, including loop members. */
export async function controlPlanProcesses(
  run: AgentPlanRun,
  action: "pause" | "resume" | "stop",
): Promise<void> {
  if (run.stopRequested && action !== "stop") return;
  const namespaces = new Map(
    allPlanRunResults(run).flatMap((step) => namespaceOwnerEntry(step)),
  );
  const scripts = allPlanRunResults(run).filter(
    (step) =>
      step.execution?.target.kind !== "remote" &&
      step.script?.closeout === "pending" &&
      !step.script.runnerOwned &&
      !step.script.runnerJob,
  );
  await Promise.all(
    scripts.map((step) =>
      step.script
        ? controlOwnedScript(
            step.script.instanceId,
            action,
            step.script.temporaryScope,
          )
        : Promise.resolve(),
    ),
  );
  const results = await Promise.allSettled(
    [...namespaces.values()].map((owner) =>
      controlOwnedNamespace(owner, action),
    ),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

function isRunnerOwnedStep(step: AgentPlanStepResult): boolean {
  if (
    step.session?.runnerOwned ||
    step.session?.runnerJob ||
    step.script?.runnerOwned ||
    step.script?.runnerJob ||
    step.execution?.target.kind === "remote"
  )
    return true;
  return false;
}

function namespaceOwnerEntry(
  step: AgentPlanStepResult,
): readonly (readonly [number, AcpNamespaceOwner])[] {
  if (isRunnerOwnedStep(step)) return [];
  const owner = step.session?.namespace ?? step.script?.namespace;
  if (!owner || step.remote) return [];
  return [[owner.pid, owner]];
}

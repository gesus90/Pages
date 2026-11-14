import { controlOwnedNamespace } from "@/backend/agents/cli/CliNamespaceControl";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { controlOwnedScript } from "./AgentPlanScriptOwner";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Applies reversible process control to every owned agent and script, including loop members. */
export async function controlPlanProcesses(
  run: AgentPlanRun,
  action: "pause" | "resume" | "stop",
): Promise<void> {
  if (run.stopRequested && action !== "stop") return;
  const namespaces = new Map(
    allPlanRunResults(run).flatMap((step) => {
      const owner = step.session?.namespace ?? step.script?.namespace;
      return owner && !step.remote ? [[owner.pid, owner] as const] : [];
    }),
  );
  const scripts = allPlanRunResults(run).filter(
    (step) => step.script?.closeout === "pending",
  );
  await Promise.all(
    scripts.map((step) =>
      step.script
        ? controlOwnedScript(step.script.instanceId, action)
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

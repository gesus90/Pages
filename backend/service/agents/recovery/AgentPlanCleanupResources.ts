import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCleanupResource } from "@/definition/AgentPlanCleanupResource";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

function stepResource(
  step: AgentPlanStepResult,
): AgentPlanCleanupResource | null {
  if (isRemoteCloseoutUnconfirmed(step)) {
    const closeout = step.remote?.closeout;
    return {
      stepId: step.id,
      kind: "remote_attempt",
      closeout:
        closeout === "pending" || closeout === "failed" ? closeout : "unknown",
    };
  }
  if (step.execution?.target.kind === "remote" || step.remote) return null;
  const scriptCloseout = step.script?.closeout;
  if (scriptCloseout === "pending" || scriptCloseout === "failed")
    return { stepId: step.id, kind: "local_script", closeout: scriptCloseout };
  const sessionCloseout = step.session?.closeout;
  if (sessionCloseout === "pending" || sessionCloseout === "failed")
    return {
      stepId: step.id,
      kind: "local_session",
      closeout: sessionCloseout,
    };
  return null;
}

function loopResource(loop: AgentPlanLoopRun): AgentPlanCleanupResource | null {
  const failed =
    loop.cleanup === "failed" ||
    loop.sessions.some((session) => session.closeout === "failed");
  const pending =
    loop.cleanup === "pending" ||
    loop.sessions.some((session) => session.closeout === "pending");
  const unknown = loop.sessions.some(
    (session) => session.state === "open" || session.instanceId === null,
  );
  if (!failed && !pending && !unknown) return null;
  let closeout: AgentPlanCleanupResource["closeout"] = "unknown";
  if (pending) closeout = "pending";
  if (failed) closeout = "failed";
  return {
    stepId: loop.id,
    kind: "loop",
    closeout,
  };
}

/** Names recorded cleanup uncertainties without exposing process, session or foreign-run identities. */
export function planCleanupResources(
  run: AgentPlanRun,
): readonly AgentPlanCleanupResource[] {
  const resources = [
    ...allPlanRunResults(run).map(stepResource),
    ...(run.loops ?? []).map(loopResource),
  ];
  const unique = new Map<string, AgentPlanCleanupResource>();
  for (const resource of resources) {
    if (!resource) continue;
    unique.set(JSON.stringify(resource), resource);
  }
  return [...unique.values()];
}

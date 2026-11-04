import { hasPlanPath } from "@/definition/AgentPlanGraph";

import { hasUnconfirmedRunCloseout } from "./AgentPlanRunState";

import type { AgentPlanEdge, AgentPlanRun } from "@/definition/AgentPlan";

function snapshotEdge(edge: unknown): AgentPlanEdge | null {
  if (
    typeof edge !== "object" ||
    edge === null ||
    !("from" in edge) ||
    !("to" in edge) ||
    !("fromPort" in edge) ||
    !("toPort" in edge) ||
    typeof edge.from !== "string" ||
    typeof edge.to !== "string" ||
    typeof edge.fromPort !== "string" ||
    typeof edge.toPort !== "string"
  )
    return null;
  return {
    from: edge.from,
    to: edge.to,
    fromPort: edge.fromPort,
    toPort: edge.toPort,
  };
}

function snapshotEdges(snapshot: unknown): readonly AgentPlanEdge[] | null {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("plan" in snapshot)
  )
    return null;
  const plan = snapshot.plan;
  if (typeof plan !== "object" || plan === null || !("edges" in plan))
    return null;
  if (!Array.isArray(plan.edges)) return null;
  const rawEdges: readonly unknown[] = plan.edges;
  const edges: AgentPlanEdge[] = [];
  for (const raw of rawEdges) {
    const edge = snapshotEdge(raw);
    if (edge === null) return null;
    edges.push(edge);
  }
  return edges;
}

/** Marks waiting descendants of failed closeouts only when the frozen graph proves the path. */
export function markDetachedCloseoutBlocks(
  run: AgentPlanRun,
  snapshot: unknown,
): AgentPlanRun {
  if (
    (run.status !== "running" && run.status !== "pausing") ||
    run.stopRequested ||
    run.controlError ||
    run.steps.some((step) => step.status === "running") ||
    hasUnconfirmedRunCloseout(run)
  )
    return run;
  const failed = run.steps.filter((step) => step.status === "failed");
  if (failed.length === 0 || failed.some((step) => step.role !== "closeout"))
    return run;
  const edges = snapshotEdges(snapshot);
  if (edges === null) return run;
  let changed = false;
  const steps = run.steps.map((step) => {
    if (
      step.isBlocked ||
      (step.status !== "waiting" && step.status !== "paused")
    )
      return step;
    const predecessor = failed.find((entry) =>
      hasPlanPath(edges, entry.id, step.id),
    );
    if (!predecessor) return step;
    changed = true;
    return {
      ...step,
      isBlocked: true,
      error: "plan_dependency_failed",
      blockedByStepId: predecessor.failedStepId ?? predecessor.id,
    };
  });
  return changed ? { ...run, steps } : run;
}

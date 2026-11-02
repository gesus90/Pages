import { patchStep } from "./AgentPlanRunState";
import { planReadiness } from "./branching/AgentPlanBranchEdges";
import { createPlanCheckpoint } from "./recovery/AgentPlanCheckpoint";

import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

/** A terminal marker acknowledges drained work without dispatching a new step or provider turn. */
export async function completePlanDrain(
  active: ActivePlanRun,
  runs: Pick<AgentPlanRunRepository, "update">,
): Promise<void> {
  if (
    active.view.status !== "pausing" ||
    active.controllers.size !== 0 ||
    active.view.controlError
  )
    return;
  // A node on a branch that was not taken has nothing left to do.
  const remaining = active.snapshot.plan.nodes.filter((node) =>
    active.view.steps.some(
      (step) =>
        step.id === node.id &&
        step.status !== "succeeded" &&
        step.status !== "skipped",
    ),
  );
  if (remaining.length === 0 || remaining.some((node) => node.type !== "end"))
    return;
  for (const node of remaining) {
    const results = new Map(active.view.steps.map((step) => [step.id, step]));
    if (planReadiness(active.snapshot.plan, results, node.id) !== "ready")
      return;
    patchStep(active, node.id, {
      status: "succeeded",
      output: null,
      error: null,
    });
    await runs.update(
      active.view,
      createPlanCheckpoint(active.view, active.snapshot, node.id),
    );
  }
}

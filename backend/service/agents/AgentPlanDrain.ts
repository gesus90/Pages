import { patchStep } from "./AgentPlanRunState";
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
  const remaining = active.snapshot.plan.nodes.filter((node) =>
    active.view.steps.some(
      (step) => step.id === node.id && step.status !== "succeeded",
    ),
  );
  if (remaining.length === 0 || remaining.some((node) => node.type !== "end"))
    return;
  for (const node of remaining) {
    const predecessors = active.snapshot.plan.edges.filter(
      (edge) => edge.to === node.id,
    );
    if (
      !predecessors.every((edge) =>
        active.view.steps.some(
          (step) => step.id === edge.from && step.status === "succeeded",
        ),
      )
    )
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

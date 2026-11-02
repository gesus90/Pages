import { AgentError } from "@/backend/error/AgentErrors";
import { planOrderEdges } from "@/definition/AgentPlanBranching";

import { planWorkStep } from "./AgentPlanWorkContext";
import { createPlanCheckpoint } from "./recovery/AgentPlanCheckpoint";
import { runnerPlanCheckpoint } from "../runner/RunnerPlanCheckpoint";

import type { AgentPlanWorkGate } from "./AgentPlanWorkGate";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/** Revalidates every gated predecessor immediately before dispatching a successor. */
export async function guardPlanWorkDispatch(
  gate: AgentPlanWorkGate | undefined,
  active: ActivePlanRun,
  stepId: string,
): Promise<void> {
  const snapshot = { ...active.snapshot };
  const own = planWorkStep(snapshot, stepId);
  const visited = new Set<string>();
  const pending = [stepId];
  // Only the nodes that ordered this start and really ran have a result to revalidate: not the way back of an event, not a skipped branch.
  const ordering = planOrderEdges(active.snapshot.plan.edges);
  const succeeded = new Set(
    active.view.steps
      .filter((step) => step.status === "succeeded")
      .map((step) => step.id),
  );
  while (pending.length) {
    const current = pending.pop();
    for (const edge of ordering) {
      if (edge.to !== current || visited.has(edge.from)) continue;
      visited.add(edge.from);
      pending.push(edge.from);
      if (!succeeded.has(edge.from)) continue;
      if (!planWorkStep(snapshot, edge.from)?.completionGate) continue;
      if (!gate) throw new AgentError("plan_work_gate_unavailable");
      await gate.verify(active.view.id, edge.from, active.view.userId);
    }
  }
  if (!own?.completionGate) return;
  if (!gate) throw new AgentError("plan_work_gate_unavailable");
  await gate.preflight(active.view.userId, active.snapshot, stepId);
}

/** Settles opt-in work without changing the result semantics of any diagnostic node. */
export async function settlePlanWorkResult(
  gate: AgentPlanWorkGate | undefined,
  active: ActivePlanRun,
  node: AgentPlanNode,
  result: Partial<AgentPlanStepResult>,
): Promise<Partial<AgentPlanStepResult>> {
  if (node.type !== "agent" || !node.completionGate) return result;
  if (!gate) throw new AgentError("plan_work_gate_unavailable");
  return gate.settle(active.view.id, node.id, result, active.view.userId);
}

/** Gated remote success is checkpointed only after the engine's fresh ticket assessment. */
export function completedPlanWorkCheckpoint(
  active: ActivePlanRun,
  node: AgentPlanNode,
  changes: Partial<AgentPlanStepResult>,
): ReturnType<typeof createPlanCheckpoint> | undefined {
  if (changes.status !== "succeeded") return undefined;
  // A node that started again keeps the checkpoint of its first completion.
  const finished = active.view.steps.find((entry) => entry.id === node.id);
  if ((finished?.activation ?? 1) > 1) return undefined;
  if (!changes.remote)
    return createPlanCheckpoint(active.view, active.snapshot, node.id);
  const remote = active.snapshot.remoteSteps?.find(
    (entry) => entry.step.id === node.id,
  );
  const isCli = remote?.command.program.kind === "cli";
  if (node.type !== "agent" || (!node.completionGate && !isCli))
    return undefined;
  const step = active.view.steps.find((entry) => entry.id === node.id);
  if (!step) throw new AgentError("plan_context_changed");
  return runnerPlanCheckpoint(active.view, active.snapshot, step);
}

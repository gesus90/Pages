import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";

/** Snapshotted task markdown and revisions come from authorized project ticket reads. */
export interface AgentPlanTaskSnapshot {
  readonly id: string;
  readonly markdown: string;
  readonly version: string;
}

/** Builds typed values for the existing A10.2 binder; result values are filled at step start. */
export function planBindings(
  plan: AgentPlan,
  step: AgentPlanStep,
  tasks: readonly AgentPlanTaskSnapshot[],
): Readonly<Record<string, AgentParameterValue | null>> {
  return Object.fromEntries(
    Object.entries(step.bindings).map(([name, binding]) => {
      if (binding.kind === "literal") return [name, binding.value];
      if (binding.kind === "result")
        return [name, { type: "text", text: "[pending predecessor result]" }];
      const source = plan.nodes.find((node) => node.id === binding.nodeId);
      if (source?.type === "parameter") return [name, source.value];
      if (
        source?.type === "variable" &&
        Object.hasOwn(plan.globals, source.name)
      )
        return [name, { type: "text", text: plan.globals[source.name] }];
      if (source?.type === "task") {
        const task = tasks.find((entry) => entry.id === source.taskId);
        if (task) return [name, { type: "text", text: task.markdown }];
      }
      throw new AgentError("plan_binding_invalid");
    }),
  );
}

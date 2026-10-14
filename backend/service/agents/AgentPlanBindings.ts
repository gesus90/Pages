import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";

/** Snapshotted task markdown and revisions come from authorized project ticket reads. */
export interface AgentPlanTaskSnapshot {
  readonly id: string;
  readonly markdown: string;
  readonly version: string;
}

/**
 * Builds typed values for the existing A10.2 binder; result values are filled at step start.
 *
 * @param plan - The saved plan whose source nodes supply the values.
 * @param step - The agent node whose bindings are resolved.
 * @param tasks - Authorized snapshots of the plan's ticket nodes.
 * @param parameters - Declarations of the step's agent; a ticket parameter
 * receives the ticket itself, a text parameter its snapshotted markdown.
 */
export function planBindings(
  plan: AgentPlan,
  step: AgentPlanStep,
  tasks: readonly AgentPlanTaskSnapshot[],
  parameters: readonly AgentParameter[],
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
      const declared = parameters.find((entry) => entry.name === name);
      if (source?.type === "task" && declared?.type === "ticket")
        return [name, { type: "ticket", ticketId: source.taskId }];
      if (source?.type === "task") {
        const task = tasks.find((entry) => entry.id === source.taskId);
        if (task) return [name, { type: "text", text: task.markdown }];
      }
      throw new AgentError("plan_binding_invalid");
    }),
  );
}

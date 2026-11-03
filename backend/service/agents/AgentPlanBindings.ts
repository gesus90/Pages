import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type {
  AgentPlan,
  AgentPlanBinding,
  AgentPlanStep,
} from "@/definition/AgentPlan";

/** Snapshotted task markdown and revisions come from authorized project ticket reads. */
export interface AgentPlanTaskSnapshot {
  readonly id: string;
  readonly markdown: string;
  readonly version: string;
}

/** The text that stands for a stack entry until a trigger hands one over. */
const PENDING_STACK_ENTRY = "[pending stack entry]";

/**
 * The prepared value of a stack output, before any trigger.
 *
 * @remarks
 * The count is final: the number of entries. The content is only a stand-in
 * that lets the preparation check the input; the entry a trigger hands over
 * replaces it when the node starts, see `planStackStepInput`.
 */
function stackValue(
  plan: AgentPlan,
  binding: Extract<AgentPlanBinding, { kind: "stack" }>,
  declared: AgentParameter | undefined,
): AgentParameterValue | null {
  const stack = plan.nodes.find((node) => node.id === binding.stackId);
  if (stack?.type !== "stack") throw new AgentError("plan_binding_invalid");
  if (binding.output === "count")
    return declared?.type === "number"
      ? { type: "number", number: stack.entries.length }
      : { type: "text", text: String(stack.entries.length) };
  if (declared?.type === "text")
    return { type: "text", text: PENDING_STACK_ENTRY };
  const first = stack.entries[0];
  if (!first) return null;
  return first.type === "task"
    ? { type: "ticket", ticketId: first.taskId }
    : first.value;
}

/** A result of another node, or of the previous iteration, is filled in when the step starts. */
function isPendingResult(
  binding: AgentPlanBinding,
): binding is Extract<AgentPlanBinding, { stepId: string }> {
  return binding.kind === "result" || binding.kind === "previous";
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
  step: Pick<AgentPlanStep, "bindings">,
  tasks: readonly AgentPlanTaskSnapshot[],
  parameters: readonly AgentParameter[],
): Readonly<Record<string, AgentParameterValue | null>> {
  return Object.fromEntries(
    Object.entries(step.bindings).map(([name, binding]) => {
      const declared = parameters.find((entry) => entry.name === name);
      if (binding.kind === "literal") return [name, binding.value];
      if (isPendingResult(binding))
        return [name, { type: "text", text: "[pending predecessor result]" }];
      if (binding.kind === "stack")
        return [name, stackValue(plan, binding, declared)];
      return [name, sourceValue(plan, binding.nodeId, { tasks, declared })];
    }),
  );
}

/** The value of a source node: a parameter, a plan variable or a ticket. */
function sourceValue(
  plan: AgentPlan,
  nodeId: string,
  context: {
    readonly tasks: readonly AgentPlanTaskSnapshot[];
    readonly declared: AgentParameter | undefined;
  },
): AgentParameterValue {
  const source = plan.nodes.find((node) => node.id === nodeId);
  if (source?.type === "parameter") return source.value;
  if (source?.type === "variable" && Object.hasOwn(plan.globals, source.name))
    return { type: "text", text: plan.globals[source.name] ?? "" };
  if (source?.type === "task" && context.declared?.type === "ticket")
    return { type: "ticket", ticketId: source.taskId };
  if (source?.type === "task") {
    const task = context.tasks.find((entry) => entry.id === source.taskId);
    if (task) return { type: "text", text: task.markdown };
  }
  throw new AgentError("plan_binding_invalid");
}

import { planStepTemplate } from "./AgentPlanConfiguration";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentParameter } from "./AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanPosition,
  AgentPlanStep,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";

/** A stable boundary port; internal source bindings refer to its ID. */
export interface AgentPlanGroupParameter extends AgentParameter {
  readonly id: string;
}

/** A sequential subgraph. Array order is the explicit execution order. */
export interface AgentPlanGroup extends AgentPlanPosition {
  readonly id: string;
  readonly type: "group";
  readonly name: string;
  readonly steps: readonly AgentPlanStep[];
  readonly parameters: readonly AgentPlanGroupParameter[];
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** Visits each agent once, including the ordered children of group nodes. */
export function allPlanSteps(plan: AgentPlanInput): readonly AgentPlanStep[] {
  return plan.nodes.flatMap((node) => {
    if (node.type === "agent") return [node];
    return node.type === "group" ? node.steps : [];
  });
}

/** Applies an agent edit without changing its subgraph membership or order. */
export function mapPlanSteps<Plan extends AgentPlanInput>(
  plan: Plan,
  transform: (step: AgentPlanStep) => AgentPlanStep,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type === "agent") return transform(node);
      return node.type === "group"
        ? { ...node, steps: node.steps.map(transform) }
        : node;
    }),
  };
}

/** Expands only scheduling and boundary bindings; the saved outer graph stays intact. */
export function expandPlanGroups<Plan extends AgentPlanInput>(
  plan: Plan,
): Plan {
  const groups = plan.nodes.filter((node) => node.type === "group");
  const nodes: AgentPlanNode[] = plan.nodes.flatMap((node) => {
    if (node.type !== "group") return [node];
    return [
      ...node.steps.map((step) => ({
        ...step,
        bindings: Object.fromEntries(
          Object.entries(step.bindings).map(([name, binding]) => {
            if (binding.kind !== "source") return [name, binding];
            const port = node.parameters.find(
              (entry) => entry.id === binding.nodeId,
            );
            return [
              name,
              port
                ? (node.bindings[port.name] ?? {
                    kind: "literal",
                    value: port.defaultValue,
                  })
                : binding,
            ];
          }),
        ),
      })),
    ];
  });
  const edges = plan.edges.map((edge) => {
    const target = groups.find((entry) => entry.id === edge.to);
    const source = groups.find((entry) => entry.id === edge.from);
    return {
      ...edge,
      from: source?.steps.at(-1)?.id ?? edge.from,
      to: target?.steps[0]?.id ?? edge.to,
    };
  });
  for (const group of groups) {
    group.steps.forEach((step, index) => {
      const next = group.steps[index + 1];
      if (next)
        edges.push({
          from: step.id,
          to: next.id,
          fromPort: "flow-out",
          toPort: "flow-in",
        });
    });
  }
  return { ...plan, nodes, edges };
}

/** Lists the named data inputs shown at the node boundary. */
export function planNodeParameters(
  node: AgentPlanNode,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentParameter[] {
  if (node.type === "group") return node.parameters;
  return node.type === "agent"
    ? (planStepTemplate(node, agents)?.parameters ?? [])
    : [];
}

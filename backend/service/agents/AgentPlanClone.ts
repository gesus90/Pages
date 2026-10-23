import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";

/** A clone uses normal creation ownership and sharing, with an explicit source revision. */
export interface AgentPlanCloneInput {
  readonly expectedRevision: number;
  readonly name: string;
  /** Omission transparently keeps the source workspace; it never copies its files. */
  readonly workspaceId?: string;
}

function invalidReference(): never {
  throw new AgentOperationError("INVALID_REQUEST", { reason: "graph_invalid" });
}

function cloneIdentities(plan: AgentPlanInput): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  const add = (id: string): void => {
    if (ids.has(id)) invalidReference();
    ids.set(id, randomUUID());
  };
  for (const node of plan.nodes) {
    add(node.id);
    if (node.type === "group" || node.type === "loop")
      for (const step of node.steps) add(step.id);
    if (node.type === "group")
      for (const parameter of node.parameters) add(parameter.id);
  }
  return ids;
}

/** Copies the entire saved graph, remapping every internal identity or refusing a dangling reference. */
export function clonePlanGraph(
  source: AgentPlanInput,
  input: AgentPlanCloneInput,
): AgentPlanInput {
  const plan = structuredClone(source);
  const ids = cloneIdentities(plan);
  const mapped = (id: string): string => ids.get(id) ?? invalidReference();
  const edges = (entries: readonly AgentPlanEdge[]): readonly AgentPlanEdge[] =>
    entries.map((edge) => ({
      ...edge,
      from: mapped(edge.from),
      to: mapped(edge.to),
    }));
  const bindings = (
    entries: Readonly<Record<string, AgentPlanBinding>>,
  ): Readonly<Record<string, AgentPlanBinding>> =>
    Object.fromEntries(
      Object.entries(entries).map(([name, binding]) => {
        if (binding.kind === "source")
          return [name, { ...binding, nodeId: mapped(binding.nodeId) }];
        if (binding.kind === "result" || binding.kind === "previous")
          return [name, { ...binding, stepId: mapped(binding.stepId) }];
        return [name, binding];
      }),
    );
  const copyStep = (step: AgentPlanStep): AgentPlanStep => ({
    ...step,
    id: mapped(step.id),
    agentId:
      step.configuration?.connectionId || step.configuration?.runnerRoute
        ? mapped(step.id)
        : step.agentId,
    bindings: bindings(step.bindings),
  });
  const copyNode = (node: AgentPlanNode): AgentPlanNode => {
    const base = { ...node, id: mapped(node.id) };
    if (node.type === "agent") return copyStep(node);
    if (base.type === "script")
      return { ...base, bindings: bindings(base.bindings) };
    if (base.type === "group")
      return {
        ...base,
        steps: base.steps.map(copyStep),
        ...(base.edges ? { edges: edges(base.edges) } : {}),
        parameters: base.parameters.map((parameter) => ({
          ...parameter,
          id: mapped(parameter.id),
        })),
        bindings: bindings(base.bindings),
      };
    if (base.type === "loop")
      return {
        ...base,
        steps: base.steps.map((step) =>
          step.type === "agent"
            ? copyStep(step)
            : {
                ...step,
                id: mapped(step.id),
                bindings: bindings(step.bindings),
              },
        ),
        edges: edges(base.edges),
        bindings: bindings(base.bindings),
        condition: base.condition
          ? {
              ...base.condition,
              sourceNodeId: mappedConditionSource(
                base.condition.sourceNodeId,
                mapped,
              ),
            }
          : null,
      };
    return base;
  };
  return {
    name: input.name,
    workspaceId: input.workspaceId ?? plan.workspaceId,
    usage: "private",
    sharing: { isGlobal: false, targets: [], operator: "or" },
    globals: plan.globals,
    nodes: plan.nodes.map(copyNode),
    edges: edges(plan.edges),
  };
}

function mappedConditionSource(
  sourceId: string,
  mapped: (id: string) => string,
): string {
  return sourceId ? mapped(sourceId) : "";
}

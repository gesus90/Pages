import { createRandomUuid } from "@/app/lib/random-uuid";

import { PLAN_GRID } from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";

/** Coordinates remain bounded integral grid points even for edited numeric fields. */
export function snapPlanCoordinate(coordinate: number): number {
  if (!Number.isFinite(coordinate)) return 0;
  return Math.min(
    6000,
    Math.max(0, Math.round(coordinate / PLAN_GRID) * PLAN_GRID),
  );
}

/** Creates an instance only from known source IDs, with an explicit default directory binding. */
export function createPlanNode(input: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly kind: AgentPlanNode["type"];
  readonly reference: string;
  readonly position?: AgentPlanPosition;
}): AgentPlanNode | null {
  const { draft, sources, kind, reference } = input;
  if (!draft.workspaceId) return null;
  const position = input.position ?? {
    x: 40 + (draft.nodes.length % 3) * 320,
    y: 40 + Math.floor(draft.nodes.length / 3) * 340,
  };
  const base = {
    id: createRandomUuid(),
    x: snapPlanCoordinate(position.x),
    y: snapPlanCoordinate(position.y),
  };
  if (kind === "start" || kind === "end") return { ...base, type: kind };
  if (kind === "agent") {
    const agent = sources.agents.find(
      (entry) => entry.id === reference && entry.availability.isUsable,
    );
    if (!agent) return null;
    return {
      ...base,
      type: "agent",
      agentId: reference,
      personalAgentId: null,
      instruction: "",
      bindings: {},
    };
  }
  if (kind === "task")
    return sources.tasks.some((task) => task.id === reference)
      ? { ...base, type: "task", taskId: reference }
      : null;
  if (kind === "parameter")
    return {
      ...base,
      type: "parameter",
      name: reference,
      format: "string",
      value: { type: "text", text: "" },
    };
  return Object.hasOwn(draft.globals, reference)
    ? { ...base, type: "variable", name: reference }
    : null;
}

/** Removing a node also removes its flow and parameter references. */
export function removePlanNode(
  draft: AgentPlanInput,
  id: string,
): AgentPlanInput {
  return {
    ...draft,
    nodes: draft.nodes
      .filter((node) => node.id !== id)
      .map((node) => {
        if (node.type !== "agent") return node;
        const bindings = Object.fromEntries(
          Object.entries(node.bindings).filter(
            ([, binding]) =>
              !(binding.kind === "source" && binding.nodeId === id) &&
              !(binding.kind === "result" && binding.stepId === id),
          ),
        );
        return { ...node, bindings };
      }),
    edges: draft.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

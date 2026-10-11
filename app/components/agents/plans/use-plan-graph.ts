import { useState } from "react";

import {
  createPlanNode,
  removePlanNode,
  snapPlanCoordinate,
} from "./plan-node-factory";
import { usePlanConnections } from "./use-plan-connections";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { Dispatch, SetStateAction } from "react";

/** Graph edits leave definitions untouched; the plan owns every node instance and binding. */
export function usePlanGraph(
  draft: AgentPlanInput,
  setDraft: Dispatch<SetStateAction<AgentPlanInput>>,
  sources: AgentPlanSources,
): {
  readonly selectedId: string | null;
  readonly select: (id: string | null) => void;
  readonly connection: ReturnType<typeof usePlanConnections>["connection"];
  readonly begin: ReturnType<typeof usePlanConnections>["begin"];
  readonly connect: ReturnType<typeof usePlanConnections>["connect"];
  readonly bindSource: ReturnType<typeof usePlanConnections>["bindSource"];
  readonly add: (
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
  ) => string | null;
  readonly move: (id: string, x: number, y: number) => void;
  readonly remove: (id: string) => void;
  readonly replaceStep: (step: AgentPlanStep) => void;
} {
  const [selectedId, select] = useState<string | null>(null);
  const connections = usePlanConnections(draft, setDraft);
  function add(
    kind: AgentPlanNode["type"],
    reference: string,
    position?: AgentPlanPosition,
  ): string | null {
    const node = createPlanNode({ draft, sources, kind, reference, position });
    if (!node) return null;
    setDraft((previous) => ({ ...previous, nodes: [...previous.nodes, node] }));
    select(node.id);
    return node.id;
  }
  function move(id: string, x: number, y: number): void {
    setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.id === id
          ? { ...node, x: snapPlanCoordinate(x), y: snapPlanCoordinate(y) }
          : node,
      ),
    }));
  }
  function remove(id: string): void {
    setDraft((previous) => removePlanNode(previous, id));
    if (selectedId === id) select(null);
    if (connections.connection?.nodeId === id) connections.begin(null);
  }
  function replaceStep(step: AgentPlanStep): void {
    setDraft((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => (node.id === step.id ? step : node)),
    }));
  }
  return { selectedId, select, ...connections, add, move, remove, replaceStep };
}

export type PlanGraphActions = ReturnType<typeof usePlanGraph>;

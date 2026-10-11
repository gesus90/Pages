import { useState } from "react";

import type { AgentPlanBinding, AgentPlanInput } from "@/definition/AgentPlan";
import type { Dispatch, SetStateAction } from "react";

interface PlanConnection {
  readonly kind: "flow" | "source" | "result";
  readonly nodeId: string;
}

function bindParameter(
  draft: AgentPlanInput,
  targetId: string,
  parameter: string,
  binding: AgentPlanBinding,
): AgentPlanInput {
  return {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.id === targetId && node.type === "agent"
        ? { ...node, bindings: { ...node.bindings, [parameter]: binding } }
        : node,
    ),
  };
}

/** Flow edges and data bindings use independent operations and distinct ports. */
export function usePlanConnections(
  draft: AgentPlanInput,
  setDraft: Dispatch<SetStateAction<AgentPlanInput>>,
): {
  readonly connection: PlanConnection | null;
  readonly begin: (connection: PlanConnection | null) => void;
  readonly connect: (id: string, parameter?: string) => void;
  readonly bindSource: (
    sourceId: string,
    targetId: string,
    parameter: string,
  ) => void;
} {
  const [connection, begin] = useState<PlanConnection | null>(null);
  function connect(id: string, parameter?: string): void {
    if (!connection || id === connection.nodeId) return;
    if (connection.kind === "flow" && parameter === undefined) {
      const edge = { from: connection.nodeId, to: id };
      if (
        !draft.edges.some(
          (entry) => entry.from === edge.from && entry.to === edge.to,
        )
      )
        setDraft({ ...draft, edges: [...draft.edges, edge] });
    } else if (connection.kind !== "flow" && parameter !== undefined) {
      const binding =
        connection.kind === "source"
          ? ({ kind: "source", nodeId: connection.nodeId } as const)
          : ({ kind: "result", stepId: connection.nodeId } as const);
      setDraft((previous) => bindParameter(previous, id, parameter, binding));
    }
    begin(null);
  }
  function bindSource(
    sourceId: string,
    targetId: string,
    parameter: string,
  ): void {
    setDraft((previous) => {
      if (
        !previous.nodes.some(
          (node) => node.id === sourceId && node.type !== "agent",
        )
      )
        return previous;
      return bindParameter(previous, targetId, parameter, {
        kind: "source",
        nodeId: sourceId,
      });
    });
  }
  return { connection, begin, connect, bindSource };
}

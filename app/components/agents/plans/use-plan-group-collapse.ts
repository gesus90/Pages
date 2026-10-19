import { useRef, useState } from "react";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Local canvas presentation only; no plan field, storage preference or runner action. */
export function usePlanGroupCollapse(
  draft: AgentPlanInput,
  graph: PlanGraphActions,
): {
  readonly collapsedGroups: ReadonlySet<string>;
  readonly toggleGroup: (id: string) => void;
} {
  const [collapsedGroups, setCollapsed] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const selections = useRef(new Map<string, string>());
  function toggleGroup(id: string): void {
    const group = draft.nodes.find(
      (node) => node.id === id && node.type === "group",
    );
    if (group?.type !== "group") return;
    const next = new Set(collapsedGroups);
    if (next.has(id)) {
      next.delete(id);
      const selected = selections.current.get(id);
      if (
        graph.selectedId === id &&
        group.steps.some((step) => step.id === selected)
      )
        graph.select(selected ?? id);
      selections.current.delete(id);
    } else {
      next.add(id);
      if (group.steps.some((step) => step.id === graph.selectedId)) {
        selections.current.set(id, graph.selectedId ?? id);
        graph.select(id);
      }
    }
    setCollapsed(next);
  }
  return { collapsedGroups, toggleGroup };
}

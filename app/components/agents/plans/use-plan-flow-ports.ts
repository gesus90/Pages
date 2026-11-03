import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

import {
  planConditionSource,
  planReceivesEvents,
} from "@/definition/AgentPlanBranching";
import { planNodeParameters } from "@/definition/AgentPlanGroup";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/**
 * Everything beside its inputs that changes how tall a card is, or where its
 * ports lie: a connected event input shows a chip, a decision names what it
 * reads, and a run adds notes and a line to a card.
 *
 * @returns A text that differs whenever one of these appears or disappears.
 */
export function planPortLayout(
  draft: AgentPlanInput,
  node: AgentPlanNode,
  result: AgentPlanStepResult | undefined,
): string {
  return JSON.stringify([
    planReceivesEvents(draft, node.id),
    planConditionSource(draft, node.id),
    result?.activation ?? 1,
    result?.passed ?? null,
    result?.trigger?.sources.length ?? 0,
    result?.condition !== undefined,
    node.type === "stack" ? node.entries.length : null,
    node.type === "loop" ? [node.mode ?? "count", node.runsSource] : null,
  ]);
}

/**
 * Measures the ports of a card again whenever its inputs, its rows or the
 * notes a run adds change, even when the card keeps the same size.
 *
 * @param node - The node of the card.
 * @param sources - The agents whose templates name the inputs.
 * @param layout - The rows that come and go, see {@link planPortLayout}.
 *
 * @remarks
 * Every edge ends at a measured port, so a row that appears or disappears
 * moves the lines with it.
 */
export function usePlanFlowPorts(
  node: AgentPlanNode,
  sources: AgentPlanSources,
  layout: string,
): void {
  const update = useUpdateNodeInternals();
  const id = node.id;
  const ports = JSON.stringify({
    inputs: planNodeParameters(node, sources.agents).map((port) => port.name),
    layout,
  });
  useEffect(() => {
    update(id);
  }, [id, ports, update]);
}

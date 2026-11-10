import { useTranslation } from "react-i18next";

import { planConditionSource } from "@/definition/AgentPlanBranching";
import { planDecisionBinding } from "@/definition/AgentPlanDecision";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { expandPlanLoops } from "@/definition/AgentPlanLoop";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";

import type {
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanNode,
} from "@/definition/AgentPlan";

/** What the data input of a decision reads. */
export type PlanDecisionSourceKind =
  "passed" | "parameter" | "ticket" | "result";

/** The source of a decision's data input, named for its card and dialog. */
export interface PlanDecisionSourceView {
  readonly nodeId: string;
  readonly kind: PlanDecisionSourceKind;
  readonly name: string;
}

/** Any node of the plan by id, the members and decisions of groups and loops included. */
export function findPlanNodeAnywhere(
  plan: AgentPlanInput,
  id: string,
): AgentPlanNode | undefined {
  return expandPlanLoops(expandPlanGroups(plan)).nodes.find(
    (node) => node.id === id,
  );
}

/** The node the bound input of a decision reads, or `null` without one. */
export function boundNodeId(decision: AgentPlanDecision): string | null {
  const binding = planDecisionBinding(decision);
  if (binding?.kind === "source") return binding.nodeId;
  return binding?.kind === "result" ? binding.stepId : null;
}

function sourceKind(
  node: AgentPlanNode | undefined,
  isEdge: boolean,
): PlanDecisionSourceKind {
  if (isEdge) return "passed";
  if (node?.type === "parameter") return "parameter";
  return node?.type === "task" ? "ticket" : "result";
}

/**
 * What a decision reads: the boolean of an agent, a parameter, a ticket or a text result.
 *
 * @param decision - The decision of the draft.
 * @returns The source with its name, or `null` while nothing is connected.
 */
export function usePlanDecisionSource(
  decision: AgentPlanDecision,
): PlanDecisionSourceView | null {
  const { t } = useTranslation();
  const { draft, sources } = usePlanFlowContext();
  const edgeSource = planConditionSource(draft, decision.id);
  const nodeId = edgeSource ?? boundNodeId(decision);
  if (nodeId === null) return null;
  const node = findPlanNodeAnywhere(draft, nodeId);
  const name = node ? planNodeLabel(node, sources) : "";
  return {
    nodeId,
    kind: sourceKind(node, edgeSource !== null),
    name: name || t("plans.run.unknownNode"),
  };
}

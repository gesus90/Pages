import { planGroupAdapter, planStepAdapter } from "@/definition/AgentPlanGroup";

import { planNodeLabel } from "./plan-layout";

import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type {
  AgentPlanGroup,
  AgentPlanGroupRefusal,
} from "@/definition/AgentPlanGroup";
import type { PlanGroupMove } from "@/definition/AgentPlanGroupEdit";

/** What the editor tells about the last change of a group's membership. */
export type PlanGroupNotice =
  | { readonly kind: "repair"; readonly name: string }
  | {
      readonly kind: "refused";
      readonly refusal: AgentPlanGroupRefusal;
      readonly name: string;
      readonly adapter: AcpProviderId | null;
      readonly groupAdapter: AcpProviderId | null;
    }
  | {
      readonly kind: "moved";
      readonly frame: "group" | "loop" | "stack";
      readonly removedEdges: number;
      readonly removedBindings: number;
    };

/**
 * Describes why a group refused an agent node.
 * @param refusal - The refusal reported by the group rules.
 * @param context - The refused step, the group and the plan sources.
 * @returns The notice shown to the user.
 */
export function refusalNotice(
  refusal: AgentPlanGroupRefusal,
  context: {
    readonly step: AgentPlanStep;
    readonly group: AgentPlanGroup;
    readonly sources: AgentPlanSources;
  },
): PlanGroupNotice {
  const { step, group, sources } = context;
  return {
    kind: "refused",
    refusal,
    name: planNodeLabel(step, sources),
    adapter: planStepAdapter(step, sources.agents),
    groupAdapter: planGroupAdapter(group, sources.agents),
  };
}

/**
 * Names the connections a move dropped; a move that dropped none needs no notice.
 * @param result - The counts of connections the move removed.
 * @param frame - The kind of frame the node was moved into.
 * @returns The notice, or `null` when nothing was dropped.
 */
export function moveNotice(
  result: Pick<
    PlanGroupMove<AgentPlanInput>,
    "removedEdges" | "removedBindings"
  >,
  frame: "group" | "loop" | "stack",
): PlanGroupNotice | null {
  if (result.removedEdges + result.removedBindings === 0) return null;
  return {
    kind: "moved",
    frame,
    removedEdges: result.removedEdges,
    removedBindings: result.removedBindings,
  };
}

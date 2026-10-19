import { PLAN_GROUP_COMPACT_HEIGHT } from "./plan-layout";
import { planLinkKey, planLinks } from "./plan-links";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanLink } from "./plan-links";

const ROUTE_LABEL_SPACING = 24;

/** Presentation metadata for an original agent edge at a compact frame. */
export interface PlanGroupRouteLabel {
  readonly routeEnd?: "from" | "to";
  readonly routeLabelOffsetY?: number;
}

/** Lists external agent links in the same stable order for anchors and labels. */
export function planGroupRouteLinks(
  plan: AgentPlanInput,
  group: AgentPlanGroup,
  side?: "from" | "to",
): readonly PlanLink[] {
  const members = new Set(group.steps.map((step) => step.id));
  return planLinks(plan).filter(
    (link) =>
      members.has(link.from) !== members.has(link.to) &&
      (side === undefined || members.has(link[side])),
  );
}

/** Spreads dense labels outside the frame, with short leaders to the unchanged anchors. */
export function planGroupRouteLabel(
  plan: AgentPlanInput,
  link: PlanLink,
  collapsed: ReadonlySet<string>,
): PlanGroupRouteLabel {
  if (collapsed.size === 0) return {};
  for (const side of ["to", "from"] as const) {
    const group = plan.nodes.find(
      (node) =>
        node.type === "group" &&
        collapsed.has(node.id) &&
        node.steps.some((step) => step.id === link[side]),
    );
    if (group?.type !== "group") continue;
    const links = planGroupRouteLinks(plan, group, side);
    const index = links.findIndex(
      (entry) => planLinkKey(entry) === planLinkKey(link),
    );
    const anchorY =
      (PLAN_GROUP_COMPACT_HEIGHT * (index + 1)) / (links.length + 1);
    const labelY =
      PLAN_GROUP_COMPACT_HEIGHT / 2 +
      (index - (links.length - 1) / 2) * ROUTE_LABEL_SPACING;
    return { routeEnd: side, routeLabelOffsetY: labelY - anchorY };
  }
  return {};
}

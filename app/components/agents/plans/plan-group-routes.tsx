import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

import { planLinkKey, planLinkLabel } from "./plan-links";
import { planGroupRouteLinks } from "./plan-group-routing";
import { usePlanFlowContext } from "./plan-flow-context";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

/** Noninteractive edge anchors retain each original member/link identity in the compact projection. */
export function PlanGroupRoutes({
  group,
  isCollapsed,
}: {
  readonly group: AgentPlanGroup;
  readonly isCollapsed: boolean;
}): React.ReactElement {
  const { draft, sources } = usePlanFlowContext();
  const update = useUpdateNodeInternals();
  const members = new Set(group.steps.map((step) => step.id));
  const links = isCollapsed ? planGroupRouteLinks(draft, group) : [];
  const signature = links.map(planLinkKey).join("|");
  useEffect(() => {
    update(group.id);
  }, [group.id, isCollapsed, signature, update]);
  return (
    <>
      {links.map((link) => {
        const isSource = members.has(link.from);
        const side = planGroupRouteLinks(
          draft,
          group,
          isSource ? "from" : "to",
        );
        const index = side.findIndex(
          (entry) => planLinkKey(entry) === planLinkKey(link),
        );
        return (
          <Handle
            key={`${planLinkKey(link)}:${isSource}`}
            id={`route:${planLinkKey(link)}:${isSource ? "from" : "to"}`}
            type={isSource ? "source" : "target"}
            position={isSource ? Position.Right : Position.Left}
            isConnectable={false}
            isConnectableStart={false}
            isConnectableEnd={false}
            aria-hidden="true"
            title={planLinkLabel(draft, sources, link)}
            style={{
              top: `${(100 * (index + 1)) / (side.length + 1)}%`,
              width: 1,
              height: 1,
              minWidth: 0,
              minHeight: 0,
              border: 0,
              background: "transparent",
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}

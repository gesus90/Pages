import { useId } from "react";

import { cn } from "@/app/lib/cn";

import { planLinkPoints } from "./plan-layout";
import { planLinkKey, planLinks } from "./plan-links";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanLinkPoints } from "./plan-layout";
import type { PlanLink } from "./plan-links";

function curve({ x1, y1, x2, y2 }: PlanLinkPoints): string {
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function ArrowMarker(props: {
  readonly id: string;
  readonly className?: string;
}): React.ReactElement {
  return (
    <marker
      id={props.id}
      className={props.className}
      markerWidth="8"
      markerHeight="8"
      refX="7"
      refY="4"
      orient="auto"
    >
      <path d="M0,0 L8,4 L0,8" fill="currentColor" />
    </marker>
  );
}

/**
 * Solid flow arrows and dashed input arrows keep execution and parameter wiring distinct.
 *
 * @remarks
 * Each line has a wider invisible stroke that selects it. The connection list
 * below the grid offers the same selection without a pointer.
 */
export function PlanEdges(props: {
  readonly plan: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly selected: PlanLink | null;
  readonly onSelect: (link: PlanLink) => void;
}): React.ReactElement {
  const markerId = useId();
  const selectedMarkerId = useId();
  const selectedKey = props.selected ? planLinkKey(props.selected) : null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground"
      aria-hidden="true"
    >
      <defs>
        <ArrowMarker id={markerId} />
        <ArrowMarker id={selectedMarkerId} className="text-primary" />
      </defs>
      {planLinks(props.plan).map((link) => {
        const points = planLinkPoints(props.plan, props.sources, link);
        if (!points) return null;
        const key = planLinkKey(link);
        const isSelected = key === selectedKey;
        const path = curve(points);
        return (
          <g key={key} className={cn(isSelected && "text-primary")}>
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="14"
              pointerEvents="stroke"
              className="cursor-pointer"
              data-plan-link={key}
              onClick={() => props.onSelect(link)}
            />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={isSelected ? 3 : 2}
              strokeDasharray={link.kind === "flow" ? undefined : "6 4"}
              markerEnd={`url(#${isSelected ? selectedMarkerId : markerId})`}
            />
            {link.kind === "data" ? (
              <text
                x={(points.x1 + points.x2) / 2}
                y={(points.y1 + points.y2) / 2 - 6}
                className="fill-current text-xs"
              >
                {link.parameter}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

import { useId } from "react";

import { cn } from "@/app/lib/cn";

import { planLinkPoints } from "./plan-layout";
import { planLinkKey, planLinks } from "./plan-links";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanLinkPoints } from "./plan-layout";
import type { PlanLink } from "./plan-links";
import type { PlanLinkPreview } from "./use-plan-link-drag";

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

/** The line from a dragged OUT to the pointer, colored by whether the IN below takes it. */
function PreviewLine(props: {
  readonly preview: PlanLinkPreview;
  readonly isValid: boolean | null;
  readonly markerId: string;
}): React.ReactElement {
  const { from, to } = props.preview;
  return (
    <path
      d={curve({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="4 4"
      markerEnd={`url(#${props.markerId})`}
      className={cn(
        "text-primary",
        props.isValid === true && "text-success",
        props.isValid === false && "text-destructive",
      )}
    />
  );
}

/**
 * Solid flow arrows and dashed input arrows keep execution and parameter wiring distinct.
 *
 * @remarks
 * Each line has a wider invisible stroke that highlights it on hover and
 * selects it on click. The connection list of the plan offers the same
 * selection without a pointer.
 */
export function PlanEdges(props: {
  readonly plan: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly selected: PlanLink | null;
  readonly onSelect: (link: PlanLink) => void;
  /** The connection being dragged, and whether the IN under the pointer takes it. */
  readonly preview?: {
    readonly line: PlanLinkPreview;
    readonly isValid: boolean | null;
  } | null;
}): React.ReactElement {
  const markerId = useId();
  const selectedMarkerId = useId();
  const previewMarkerId = useId();
  const selectedKey = props.selected ? planLinkKey(props.selected) : null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground"
      aria-hidden="true"
    >
      <defs>
        <ArrowMarker id={markerId} />
        <ArrowMarker id={selectedMarkerId} className="text-primary" />
        <ArrowMarker id={previewMarkerId} />
      </defs>
      {planLinks(props.plan).map((link) => {
        const points = planLinkPoints(props.plan, props.sources, link);
        if (!points) return null;
        const key = planLinkKey(link);
        const isSelected = key === selectedKey;
        const path = curve(points);
        return (
          <g
            key={key}
            className={cn(
              "group/link hover:text-foreground",
              isSelected && "text-primary hover:text-primary",
            )}
          >
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="20"
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
              className="group-hover/link:stroke-[3]"
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
      {props.preview ? (
        <PreviewLine
          preview={props.preview.line}
          isValid={props.preview.isValid}
          markerId={previewMarkerId}
        />
      ) : null}
    </svg>
  );
}

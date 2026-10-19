import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "./plan-flow-context";
import { keepPlanControlKeys } from "./plan-flow-keys";

import type { EdgeProps } from "@xyflow/react";
import type { PlanFlowEdge } from "./plan-flow-model";

const ACTION_OFFSET = 32;
const ROUTE_LABEL_GAP = 16;
const PORT_DIRECTIONS = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

/** Every connection is a soft curve; flow is solid, a parameter binding is dashed and names its input. */
export function PlanFlowEdgeView(
  props: EdgeProps<PlanFlowEdge>,
): React.ReactElement | null {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const isDisconnecting = useRef(false);
  const details = props.data;
  if (!details) return null;
  const isData = details.link.kind === "data";
  const [path, labelX, labelY] = renderedEdgePath(props);
  let label = t("plans.linkKind.flow");
  if (details.link.kind === "data") label = details.link.parameter;
  if (details.routeEnd) label = details.name;
  function disconnect(event: React.MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit || !details || isDisconnecting.current) return;
    isDisconnecting.current = true;
    graph.disconnect(details.link);
    event.currentTarget.closest("section")?.focus({ preventScroll: true });
  }
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={28}
        style={{
          stroke: props.selected
            ? "var(--color-foreground)"
            : "var(--color-muted-foreground)",
          strokeWidth: props.selected ? 2.5 : 1.75,
          strokeDasharray: isData ? "6 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{
            transform: edgeLabelTransform(props, { x: labelX, y: labelY }),
          }}
        >
          <button
            type="button"
            className={cn(
              "max-w-40 truncate rounded-full border bg-surface px-2 py-0.5 text-[10px] shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              props.selected
                ? "border-foreground/60 text-foreground"
                : "border-border text-muted-foreground",
              isData && "border-dashed",
            )}
            title={details.name}
            aria-label={`${t(`plans.linkKind.${details.link.kind}`)}: ${details.name}`}
            aria-pressed={props.selected}
            onClick={() => graph.selectLink(details.link)}
          >
            {isData ? "◇ " : "→ "}
            {label}
          </button>
        </div>
        {props.selected && canEdit ? (
          <>
            <EdgeEndAction
              x={props.sourceX}
              y={props.sourceY}
              position={props.sourcePosition}
              label={t("plans.removeLinkAtSource", { name: details.name })}
              onDisconnect={disconnect}
            />
            <EdgeEndAction
              x={props.targetX}
              y={props.targetY}
              position={props.targetPosition}
              label={t("plans.removeLinkAtTarget", { name: details.name })}
              onDisconnect={disconnect}
            />
          </>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

function edgeLabelTransform(
  props: EdgeProps<PlanFlowEdge>,
  midpoint: { readonly x: number; readonly y: number },
): string {
  const point = routeLabelPoint(props);
  if (!point)
    return `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px)`;
  const anchor = point.isSource ? "0" : "-100%";
  return `translate(${anchor}, -50%) translate(${point.x}px, ${point.y}px)`;
}

interface GroupRoutePoint {
  readonly x: number;
  readonly y: number;
  readonly isSource: boolean;
}

function routeLabelPoint(
  props: EdgeProps<PlanFlowEdge>,
): GroupRoutePoint | null {
  const offset = props.data?.routeLabelOffsetY ?? 0;
  if (props.data?.routeEnd === "from")
    return {
      x: props.sourceX + ROUTE_LABEL_GAP,
      y: props.sourceY + offset,
      isSource: true,
    };
  if (props.data?.routeEnd === "to")
    return {
      x: props.targetX - ROUTE_LABEL_GAP,
      y: props.targetY + offset,
      isSource: false,
    };
  return null;
}

function renderedEdgePath(
  props: EdgeProps<PlanFlowEdge>,
): ReturnType<typeof getBezierPath> {
  const point = routeLabelPoint(props);
  if (!point) return getBezierPath(props);
  const [path, x, y, offsetX, offsetY] = getBezierPath({
    ...props,
    sourceX: point.isSource ? point.x : props.sourceX,
    sourceY: point.isSource ? point.y : props.sourceY,
    targetX: point.isSource ? props.targetX : point.x,
    targetY: point.isSource ? props.targetY : point.y,
  });
  // One continuous subpath gives the edge exactly one terminal arrow.
  const curve = path.slice(path.indexOf("C"));
  const routed = point.isSource
    ? `M${props.sourceX},${props.sourceY}L${point.x},${point.y} ${curve}`
    : `${path}L${props.targetX},${props.targetY}`;
  return [routed, x, y, offsetX, offsetY];
}

interface EdgeEndActionProps {
  readonly x: number;
  readonly y: number;
  readonly position: Position;
  readonly label: string;
  readonly onDisconnect: React.MouseEventHandler<HTMLButtonElement>;
}

function EdgeEndAction(props: EdgeEndActionProps): React.ReactElement {
  const direction = PORT_DIRECTIONS[props.position];
  const x = props.x + direction.x * ACTION_OFFSET;
  const y = props.y + direction.y * ACTION_OFFSET;
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className="nodrag nopan pointer-events-auto absolute flex size-8 items-center justify-center rounded-full text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={keepPlanControlKeys}
      onClick={props.onDisconnect}
    >
      <span className="flex size-5 items-center justify-center rounded-full border border-muted-foreground bg-surface shadow-xs hover:bg-muted">
        <X className="size-3" aria-hidden="true" />
      </span>
    </button>
  );
}

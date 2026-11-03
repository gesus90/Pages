import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "./plan-flow-context";
import { keepPlanControlKeys } from "./plan-flow-keys";
import {
  PLAN_LINK_DASH,
  PLAN_LINK_LABEL_TONE,
  PLAN_LINK_STROKE,
} from "./plan-link-style";
import {
  isPlanReturn,
  planPortCentre,
  planReturnPath,
} from "./plan-flow-route";
import { planLinkChannel } from "./plan-links";

import type { EdgeProps, InternalNode } from "@xyflow/react";
import type { TFunction } from "i18next";
import type { PlanFlowEdge } from "./plan-flow-model";
import type { PlanLinkChannel } from "./plan-links";

const ACTION_OFFSET = 32;
/** Half the width of a port dot. */
const PORT_RADIUS = 6;
const ROUTE_LABEL_GAP = 16;
const PORT_DIRECTIONS = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

/** The text before a label: the arrow of a flow, the diamond of a binding; the other kinds name themselves. */
const LABEL_MARKS: Readonly<Record<PlanLinkChannel, string>> = {
  flow: "→ ",
  data: "◇ ",
  condition: "",
  true: "",
  false: "",
  event: "",
};

/** The lowest edge of a card, or 0 while it is not measured yet. */
function nodeBottom(node: InternalNode | undefined): number {
  if (!node) return 0;
  return node.internals.positionAbsolute.y + (node.measured.height ?? 0);
}

/**
 * The arrow of a connection.
 *
 * @remarks
 * The line ends at the centre of its port, which a port dot covers. The tip of
 * the arrow therefore sits one port radius before the end of the line, on the
 * rim of the dot, so the direction stays visible.
 */
function PortArrow(props: {
  readonly id: string;
  readonly color: string;
}): React.ReactElement {
  return (
    <defs>
      <marker
        id={props.id}
        viewBox="-8 -8 16 16"
        markerWidth="16"
        markerHeight="16"
        markerUnits="userSpaceOnUse"
        refX={PORT_RADIUS}
        refY="0"
        orient="auto"
      >
        <polygon
          points="-6,-4.5 0,0 -6,4.5"
          strokeLinejoin="round"
          style={{ fill: props.color, stroke: props.color }}
        />
      </marker>
    </defs>
  );
}

/** The edge with both ends moved from the rim of their port to its centre; an unmeasured end stays where it is. */
function withPortCentres(
  props: EdgeProps<PlanFlowEdge>,
  source: InternalNode | undefined,
  target: InternalNode | undefined,
): EdgeProps<PlanFlowEdge> {
  if (props.data?.isBoundary) return props;
  const from = planPortCentre(source, "source", props.sourceHandleId);
  const to = planPortCentre(target, "target", props.targetHandleId);
  return {
    ...props,
    ...(from ? { sourceX: from.x, sourceY: from.y } : {}),
    ...(to ? { targetX: to.x, targetY: to.y } : {}),
  };
}

/** The label of a binding: the input it fills, after the stack output it reads; a loop names its Count or While input. */
function dataLabelText(
  t: TFunction,
  link: Extract<NonNullable<PlanFlowEdge["data"]>["link"], { kind: "data" }>,
): string {
  const input = link.isLoopInput
    ? t(`plans.loops.inputName.${link.parameter}`)
    : link.parameter;
  return link.output
    ? `${t(`plans.stack.output.${link.output}`)} · ${input}`
    : input;
}

/** What the visible label of a connection says: its kind in words, or the input a binding fills. */
function edgeLabelText(
  t: TFunction,
  details: NonNullable<PlanFlowEdge["data"]>,
  channel: PlanLinkChannel,
): string {
  if (details.routeEnd) return details.name;
  if (details.link.kind === "data") return dataLabelText(t, details.link);
  return t(
    channel === "flow" ? "plans.linkKind.flow" : `plans.linkLabel.${channel}`,
  );
}

/**
 * Every connection is a soft curve; flow is solid, a parameter binding is dashed and names its input.
 *
 * @remarks
 * The boolean wire, the two branches of a decision and the new prompt that
 * returns to an agent differ in colour, dash and label. The way back runs
 * below both of its cards, so that it crosses neither.
 */
export function PlanFlowEdgeView(
  edgeProps: EdgeProps<PlanFlowEdge>,
): React.ReactElement | null {
  const { graph, canEdit } = usePlanFlowContext();
  const isDisconnecting = useRef(false);
  const source = useInternalNode(edgeProps.source);
  const target = useInternalNode(edgeProps.target);
  const props = withPortCentres(edgeProps, source, target);
  const arrowId = useId();
  const details = props.data;
  if (!details) return null;
  const channel = planLinkChannel(details.link);
  const bottom = Math.max(nodeBottom(source), nodeBottom(target));
  if (details.isBoundary)
    return (
      <BaseEdge
        id={props.id}
        path={getBezierPath(props)[0]}
        markerEnd={props.markerEnd}
        interactionWidth={0}
        style={{
          stroke: "var(--color-muted-foreground)",
          strokeWidth: 1.75,
        }}
      />
    );
  const [path, labelX, labelY] = renderedEdgePath(props, channel, bottom);
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
      <PortArrow id={arrowId} color={PLAN_LINK_STROKE[channel]} />
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={`url(#${arrowId})`}
        interactionWidth={28}
        data-plan-link={channel}
        style={{
          stroke: props.selected
            ? "var(--color-foreground)"
            : PLAN_LINK_STROKE[channel],
          strokeWidth: props.selected ? 2.5 : 1.75,
          strokeDasharray: PLAN_LINK_DASH[channel],
        }}
      />
      <EdgeLabelRenderer>
        <PlanFlowEdgeLabel
          {...props}
          channel={channel}
          anchor={{ x: labelX, y: labelY }}
        />
        {props.selected && canEdit ? (
          <EdgeEndActions {...props} onDisconnect={disconnect} />
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

interface PlanFlowEdgeLabelProps extends EdgeProps<PlanFlowEdge> {
  readonly channel: PlanLinkChannel;
  readonly anchor: { readonly x: number; readonly y: number };
}

/** The selectable label in the middle of a connection; it names the kind of the connection in words. */
function PlanFlowEdgeLabel(
  props: PlanFlowEdgeLabelProps,
): React.ReactElement | null {
  const { t } = useTranslation();
  const { graph } = usePlanFlowContext();
  const details = props.data;
  if (!details) return null;
  return (
    <div
      className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
      style={{ transform: edgeLabelTransform(props, props.anchor) }}
    >
      <button
        type="button"
        data-plan-link-label={props.channel}
        className={cn(
          "max-w-48 truncate rounded-full border bg-surface px-2 py-0.5 text-[10px] shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          props.selected
            ? "border-foreground/60 text-foreground"
            : PLAN_LINK_LABEL_TONE[props.channel],
          props.selected &&
            PLAN_LINK_DASH[props.channel] !== undefined &&
            "border-dashed",
        )}
        title={details.name}
        aria-label={`${t(`plans.linkKind.${props.channel}`)}: ${details.name}`}
        aria-pressed={props.selected}
        onClick={() => graph.selectLink(details.link)}
      >
        {LABEL_MARKS[props.channel]}
        {edgeLabelText(t, details, props.channel)}
      </button>
    </div>
  );
}

/** The two buttons that release a selected connection at its source and at its target. */
function EdgeEndActions(
  props: EdgeProps<PlanFlowEdge> & {
    readonly onDisconnect: React.MouseEventHandler<HTMLButtonElement>;
  },
): React.ReactElement | null {
  const { t } = useTranslation();
  const name = props.data?.name ?? "";
  return (
    <>
      <EdgeEndAction
        x={props.sourceX}
        y={props.sourceY}
        position={props.sourcePosition}
        label={t("plans.removeLinkAtSource", { name })}
        onDisconnect={props.onDisconnect}
      />
      <EdgeEndAction
        x={props.targetX}
        y={props.targetY}
        position={props.targetPosition}
        label={t("plans.removeLinkAtTarget", { name })}
        onDisconnect={props.onDisconnect}
      />
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
  channel: PlanLinkChannel,
  bottom: number,
): readonly [path: string, labelX: number, labelY: number] {
  const point = routeLabelPoint(props);
  if (!point && channel === "event" && isPlanReturn({ ...props, bottom }))
    return planReturnPath({ ...props, bottom });
  if (!point) {
    const [curve, x, y] = getBezierPath(props);
    return [curve, x, y];
  }
  const [path, x, y] = getBezierPath({
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
  return [routed, x, y];
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

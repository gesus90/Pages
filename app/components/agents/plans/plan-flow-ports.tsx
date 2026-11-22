import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import { PlanFlowHandle } from "./plan-flow-handle";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

// The flow dots of a card sit 30 px below its top edge and reach 6 px past
// its 1 px edge; the 10 px dot is centred 2 px outside the padding box.
const HEADER_DOT = { top: 30, edge: -2 } as const;
// The keyboard button lies over the dot without taking its pointer: dragging
// and clicking stay with the dot, focus and Enter with the button. Its 24 px
// circle is centred on the dot.
const DOT_BUTTON =
  "nodrag nopan pointer-events-none absolute size-6 -translate-y-1/2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const DOT_BUTTON_RADIUS = 12;

/**
 * Marks an IN as an allowed or a refused end of the connection being made.
 * @returns No class while no connection is open.
 */
export function planInTargetClass(
  graph: PlanGraphActions,
  id: string,
  parameter?: string,
): string | false {
  if (!graph.connection) return false;
  return graph.canConnect(id, parameter)
    ? "border-success bg-success-subtle text-success"
    : "cursor-not-allowed border-dashed opacity-50";
}

/** Which flow dots a card shows and how its flow OUT is named. */
export interface PlanFlowDots {
  readonly hasIn: boolean;
  readonly hasOut: boolean;
  /** The name of the flow OUT, such as the exit of a calling Jump; else „Ablauf OUT“. */
  readonly outLabel?: string;
}

/**
 * The flow dots a node shows on its card header by default.
 * @remarks
 * Start exposes only OUT, end only IN; every other flow node both; value
 * sources such as tickets have none.
 */
export function planFlowDots(node: AgentPlanNode): PlanFlowDots {
  if (!isPlanFlowNode(node)) return { hasIn: false, hasOut: false };
  return { hasIn: node.type !== "start", hasOut: node.type !== "end" };
}

/** The class of a flow IN button while a connection is open: allowed or refused. */
function inTargetRing(graph: PlanGraphActions, id: string): string | false {
  if (!graph.connection) return false;
  return graph.canConnect(id)
    ? "ring-2 ring-success"
    : "cursor-not-allowed opacity-50";
}

/**
 * One flow dot on the edge of a node: the IN on the left, the OUT on the right.
 * @remarks
 * The dot is the React Flow handle with its name as tooltip; a labelled
 * button over it gives keyboards the same port with a focus ring. `top` is
 * the dot's centre below the node's top edge, `edge` its centre's offset
 * from the left or right edge.
 */
export function PlanFlowDot(props: {
  readonly nodeId: string;
  readonly side: "in" | "out";
  readonly label: string;
  readonly top: number | string;
  readonly edge: number;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly hasIssue: boolean;
  /** The accessible name of the button, when it says more than the tooltip. */
  readonly buttonLabel?: string;
}): React.ReactElement {
  const { graph, nodeId, top, edge } = props;
  const isIn = props.side === "in";
  const handleStyle: React.CSSProperties = isIn
    ? { top, left: edge, right: "auto", transform: "translate(-50%, -50%)" }
    : { top, left: "auto", right: edge, transform: "translate(50%, -50%)" };
  const buttonStyle: React.CSSProperties = isIn
    ? { top, left: edge - DOT_BUTTON_RADIUS }
    : { top, right: edge - DOT_BUTTON_RADIUS };
  const isActive =
    graph.connection?.nodeId === nodeId && graph.connection.kind === "flow";
  return (
    <>
      <PlanFlowHandle
        id={isIn ? "flow-in" : "flow-out"}
        type={isIn ? "target" : "source"}
        kind="flow"
        hasIssue={props.hasIssue}
        title={props.label}
        style={handleStyle}
      />
      <button
        type="button"
        data-plan-in={isIn ? nodeId : undefined}
        data-plan-out={isIn ? undefined : nodeId}
        data-plan-out-kind={isIn ? undefined : "flow"}
        aria-label={props.buttonLabel ?? props.label}
        className={cn(
          DOT_BUTTON,
          isIn
            ? inTargetRing(graph, nodeId)
            : isActive && "ring-2 ring-primary",
        )}
        style={buttonStyle}
        disabled={!props.canEdit}
        onClick={() =>
          isIn ? graph.connect(nodeId) : graph.begin({ kind: "flow", nodeId })
        }
      />
    </>
  );
}

/**
 * The flow IN and OUT of a card as dots on its edge, level with the header.
 * @remarks
 * The dots carry no text row; their names stand in the tooltip and on the
 * labelled buttons that keyboards reach. Dragging from an OUT to an IN
 * connects them; clicking the OUT and then the IN does the same without a
 * drag.
 */
export function PlanFlowPorts(props: {
  readonly node: AgentPlanNode;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly dots: PlanFlowDots;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { node, graph, dots } = props;
  function issue(port: string): boolean {
    return graph.issues.some(
      (entry) => entry.nodeId === node.id && entry.port === port,
    );
  }
  const shared = {
    nodeId: node.id,
    graph,
    canEdit: props.canEdit,
    ...HEADER_DOT,
  };
  return (
    <>
      {dots.hasIn ? (
        <PlanFlowDot
          {...shared}
          side="in"
          label={t("plans.flowIn")}
          hasIssue={issue("flow-in")}
        />
      ) : null}
      {dots.hasOut ? (
        <PlanFlowDot
          {...shared}
          side="out"
          label={dots.outLabel ?? t("plans.flowOut")}
          hasIssue={issue("flow-out")}
        />
      ) : null}
    </>
  );
}

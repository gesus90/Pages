import { useTranslation } from "react-i18next";

import { PlanFlowHandle } from "./plan-flow-handle";
import { PLAN_FRAME_HEADER } from "./plan-layout";
import { PlanFlowDot } from "./plan-flow-ports";

import type { PlanGraphActions } from "./use-plan-graph";

/** Where the loop's four flow dots sit: centered on the container edge, at half the header height. */
export const PLAN_LOOP_PORT_TOP = Math.round(PLAN_FRAME_HEADER / 2);

/**
 * Where the data input of the count or the while boolean sits: level with
 * the second header line, whose centre is 10 px above the header's lower edge.
 */
export const PLAN_LOOP_INPUT_TOP = PLAN_FRAME_HEADER - 1 - 10 - 10;

// A dot on the container edge is centered on that edge, so the inline offsets
// name the edge itself and the transform pulls half the dot back.
const LEFT_EDGE = {
  top: PLAN_LOOP_PORT_TOP,
  left: 0,
  right: "auto",
  transform: "translate(-50%, -50%)",
} as const;
const RIGHT_EDGE = {
  top: PLAN_LOOP_PORT_TOP,
  left: "auto",
  right: 0,
  transform: "translate(50%, -50%)",
} as const;

/**
 * The entry and the exit of a loop on its container edge, at half the header height.
 * @remarks
 * The outer flow connects to `flow-in` and leaves from `flow-out`. The
 * `inner-in` and `inner-out` handles lie at the same two points; they only
 * anchor the lines to the first and last members and cannot start a
 * connection. All four are measured by React Flow, so lines end at the real
 * centers of the dots. A labelled button over each outer dot gives the
 * keyboard the same two ports.
 */
export function PlanLoopPorts(props: {
  readonly loopId: string;
  readonly label: string;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, loopId } = props;
  const hasIssue = (port: string): boolean =>
    graph.issues.some(
      (issue) => issue.nodeId === loopId && issue.port === port,
    );
  const shared = {
    nodeId: loopId,
    graph,
    canEdit: props.canEdit,
    top: PLAN_LOOP_PORT_TOP,
    edge: 0,
  };
  return (
    <>
      <PlanFlowDot
        {...shared}
        side="in"
        label={t("plans.flowIn")}
        buttonLabel={t("plans.loops.flowIn", { name: props.label })}
        hasIssue={hasIssue("flow-in")}
      />
      <PlanFlowHandle
        id="inner-in"
        type="source"
        kind="flow"
        isDecorative
        style={LEFT_EDGE}
      />
      <PlanFlowHandle
        id="inner-out"
        type="target"
        kind="flow"
        isDecorative
        style={RIGHT_EDGE}
      />
      <PlanFlowDot
        {...shared}
        side="out"
        label={t("plans.flowOut")}
        buttonLabel={t("plans.loops.flowOut", { name: props.label })}
        hasIssue={hasIssue("flow-out")}
      />
    </>
  );
}

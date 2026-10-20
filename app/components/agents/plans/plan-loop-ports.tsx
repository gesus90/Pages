import { useTranslation } from "react-i18next";

import { PlanFlowHandle } from "./plan-flow-handle";
import { planGroupHeaderHeight } from "./plan-layout";
import { planInTargetClass } from "./plan-flow-ports";

import type { PlanGraphActions } from "./use-plan-graph";

/** The row of the first member's ports below the header; the loop's dots sit on its level. */
const PORT_ROW_OFFSET = 66;

/** Where the loop's four dots sit: centered on the container edge, level with the ports of the first row. */
export const PLAN_LOOP_PORT_TOP = planGroupHeaderHeight() + PORT_ROW_OFFSET;

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
 * The entry and the exit of a loop on its container edge.
 *
 * @remarks
 * The outer flow connects to `flow-in` and leaves from `flow-out`. The
 * `inner-in` and `inner-out` handles lie at the same two points; they only
 * anchor the lines to the first and last members and cannot start a
 * connection. All four are measured by React Flow, so lines end at the real
 * centers of the dots. Two buttons give the keyboard the same two ports.
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
  return (
    <>
      <PlanFlowHandle
        id="flow-in"
        type="target"
        kind="flow"
        hasIssue={hasIssue("flow-in")}
        style={LEFT_EDGE}
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
      <PlanFlowHandle
        id="flow-out"
        type="source"
        kind="flow"
        hasIssue={hasIssue("flow-out")}
        style={RIGHT_EDGE}
      />
      <button
        type="button"
        data-plan-in={loopId}
        aria-label={t("plans.loops.flowIn", { name: props.label })}
        className={`sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-10 focus-visible:rounded-md focus-visible:border focus-visible:bg-surface focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:ring-2 focus-visible:ring-ring ${planInTargetClass(graph, loopId) || ""}`}
        disabled={!props.canEdit}
        onClick={() => graph.connect(loopId)}
      >
        {t("plans.flowInShort")}
      </button>
      <button
        type="button"
        data-plan-out={loopId}
        data-plan-out-kind="flow"
        aria-label={t("plans.loops.flowOut", { name: props.label })}
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:right-2 focus-visible:z-10 focus-visible:rounded-md focus-visible:border focus-visible:bg-surface focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:ring-2 focus-visible:ring-ring"
        disabled={!props.canEdit}
        onClick={() => graph.begin({ kind: "flow", nodeId: loopId })}
      >
        {t("plans.flowOutShort")}
      </button>
    </>
  );
}

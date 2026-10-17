import { getBezierPath, getSmoothStepPath } from "@xyflow/react";

import { usePlanFlowContext } from "./plan-flow-context";

import type { ConnectionLineComponentProps } from "@xyflow/react";

/** The live preview follows the same flow/data line grammar and marks invalid targets. */
export function PlanFlowConnectionLine(
  props: ConnectionLineComponentProps,
): React.ReactElement | null {
  const { graph } = usePlanFlowContext();
  if (!graph.connection) return null;
  const isData = graph.connection.kind !== "flow";
  const options = {
    sourceX: props.fromX,
    sourceY: props.fromY,
    sourcePosition: props.fromPosition,
    targetX: props.toX,
    targetY: props.toY,
    targetPosition: props.toPosition,
  };
  const [path] = isData ? getSmoothStepPath(options) : getBezierPath(options);
  const color =
    props.connectionStatus === "invalid"
      ? "var(--color-destructive)"
      : "var(--color-info)";
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={isData ? "6 5" : undefined}
      />
      <circle
        cx={props.toX}
        cy={props.toY}
        r={4}
        fill="var(--color-surface)"
        stroke={color}
        strokeWidth={2}
      />
    </g>
  );
}

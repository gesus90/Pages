import { Handle, Position } from "@xyflow/react";

import { cn } from "@/app/lib/cn";

import styles from "./plan-canvas.module.css";
import { usePlanFlowContext } from "./plan-flow-context";

/** Large pointer targets supplement the labelled port buttons used by keyboards. */
export function PlanFlowHandle(props: {
  readonly id: string;
  readonly type: "source" | "target";
  readonly kind: "flow" | "data";
  readonly hasIssue?: boolean;
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  const { canEdit } = usePlanFlowContext();
  return (
    <Handle
      id={props.id}
      type={props.type}
      position={props.type === "source" ? Position.Right : Position.Left}
      isConnectable={canEdit}
      isConnectableStart={canEdit && props.type === "source"}
      isConnectableEnd={canEdit && props.type === "target"}
      aria-hidden="true"
      className={cn(
        styles.portHandle,
        props.kind === "flow" ? styles.flowHandle : styles.dataHandle,
        props.hasIssue && styles.invalidHandle,
      )}
      style={props.style}
    />
  );
}

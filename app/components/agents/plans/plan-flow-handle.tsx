import { Handle, Position } from "@xyflow/react";

import { cn } from "@/app/lib/cn";

import styles from "./plan-canvas.module.css";
import { usePlanFlowContext } from "./plan-flow-context";

/** The colour of a port by what it carries; the boolean result, both branches and the new prompt have their own. */
export type PlanHandleKind =
  "flow" | "data" | "logic" | "true" | "false" | "event";

const HANDLE_CLASSES: Readonly<Record<PlanHandleKind, string>> = {
  flow: styles.flowHandle,
  data: styles.dataHandle,
  logic: styles.logicHandle,
  true: styles.trueHandle,
  false: styles.falseHandle,
  event: styles.eventHandle,
};

/** Large pointer targets supplement the labelled port buttons used by keyboards. */
export function PlanFlowHandle(props: {
  readonly id: string;
  readonly type: "source" | "target";
  readonly kind: PlanHandleKind;
  readonly hasIssue?: boolean;
  readonly style?: React.CSSProperties;
  /** Only anchors a line; it can neither start nor end a connection and shows no dot. */
  readonly isDecorative?: boolean;
}): React.ReactElement {
  const { canEdit } = usePlanFlowContext();
  const isConnectable = canEdit && !props.isDecorative;
  return (
    <Handle
      id={props.id}
      type={props.type}
      position={props.type === "source" ? Position.Right : Position.Left}
      isConnectable={isConnectable}
      isConnectableStart={isConnectable && props.type === "source"}
      isConnectableEnd={isConnectable && props.type === "target"}
      aria-hidden="true"
      className={cn(
        styles.portHandle,
        HANDLE_CLASSES[props.kind],
        props.isDecorative && styles.anchorHandle,
        props.hasIssue && styles.invalidHandle,
      )}
      style={props.style}
    />
  );
}

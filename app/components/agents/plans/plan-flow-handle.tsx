import { Handle, Position } from "@xyflow/react";

import { cn } from "@/app/lib/cn";

import styles from "./plan-canvas.module.css";
import { usePlanFlowContext } from "./plan-flow-context";

/**
 * The colour and shape of a port by what it carries.
 * @remarks
 * The boolean result, both branches and the new prompt have their own colour.
 * A signal payload is blue, the failure output of a Jump a filled red diamond
 * and its timeout output a hollow amber diamond, so the shape names them as
 * well as the colour.
 */
export type PlanHandleKind =
  | "flow"
  | "data"
  | "logic"
  | "true"
  | "false"
  | "event"
  | "signal"
  | "error"
  | "timeout";

const HANDLE_CLASSES: Readonly<Record<PlanHandleKind, string>> = {
  flow: styles.flowHandle,
  data: styles.dataHandle,
  logic: styles.logicHandle,
  true: styles.trueHandle,
  false: styles.falseHandle,
  event: styles.eventHandle,
  signal: styles.signalHandle,
  error: styles.errorHandle,
  timeout: styles.timeoutHandle,
};

/**
 * Large pointer targets supplement the labelled port buttons used by keyboards.
 * @remarks
 * A value input is the smaller 8 px dot; flow ports and outputs are 10 px.
 */
export function PlanFlowHandle(props: {
  readonly id: string;
  readonly type: "source" | "target";
  readonly kind: PlanHandleKind;
  readonly hasIssue?: boolean;
  readonly style?: React.CSSProperties;
  /** Only anchors a line; it can neither start nor end a connection and shows no dot. */
  readonly isDecorative?: boolean;
  /** The tooltip of the dot, such as „Ablauf IN“ for a flow port without a text row. */
  readonly title?: string;
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
      title={props.title}
      className={cn(
        styles.portHandle,
        HANDLE_CLASSES[props.kind],
        props.type === "target" && props.kind !== "flow" && styles.inputHandle,
        props.isDecorative && styles.anchorHandle,
        props.hasIssue && styles.invalidHandle,
      )}
      style={props.style}
    />
  );
}

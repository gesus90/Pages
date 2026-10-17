import { useStoreApi } from "@xyflow/react";
import { useRef } from "react";

import { planFlowConnection, planFlowSource } from "./plan-flow-model";

import type { Connection, OnConnectEnd, OnConnectStart } from "@xyflow/react";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanFlowEdge } from "./plan-flow-model";
import type { PlanGraphActions } from "./use-plan-graph";

interface FlowConnectionActions {
  readonly isValidConnection: (
    connection: Connection | PlanFlowEdge,
  ) => boolean;
  readonly onConnect: (connection: Connection) => void;
  readonly onConnectStart: OnConnectStart;
  readonly onConnectEnd: OnConnectEnd;
  readonly onClickConnectStart: OnConnectStart;
  readonly onClickConnectEnd: OnConnectEnd;
  readonly cancel: () => void;
}

/** Every library gesture passes the existing domain validation, including group boundaries. */
export function usePlanFlowConnections(options: {
  readonly draft: AgentPlanInput;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): FlowConnectionActions {
  const { draft, graph, canEdit } = options;
  const store = useStoreApi();
  const isCancelled = useRef(false);
  function isValidConnection(connection: Connection | PlanFlowEdge): boolean {
    if (!canEdit) return false;
    const request = planFlowConnection(draft, {
      ...connection,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
    });
    return (
      request !== null &&
      graph.canConnectFrom(request.source, request.targetId, request.parameter)
    );
  }
  function onConnect(connection: Connection): void {
    if (!canEdit || isCancelled.current) return;
    const request = planFlowConnection(draft, connection);
    if (request)
      graph.connectFrom(request.source, request.targetId, request.parameter);
  }
  const onConnectStart: OnConnectStart = (event, port) => {
    if (!canEdit || !port.nodeId || port.handleType !== "source") return;
    isCancelled.current = false;
    graph.begin(planFlowSource(draft, port.nodeId, port.handleId));
  };
  const onConnectEnd: OnConnectEnd = (event, state) => {
    if (
      canEdit &&
      state.isValid === false &&
      state.fromHandle &&
      state.toHandle?.type === "target"
    ) {
      onConnect({
        source: state.fromHandle.nodeId,
        sourceHandle: state.fromHandle.id ?? null,
        target: state.toHandle.nodeId,
        targetHandle: state.toHandle.id ?? null,
      });
      return;
    }
    graph.begin(null);
  };
  function cancel(): void {
    isCancelled.current = true;
    store.getState().cancelConnection();
    store.setState({ connectionClickStartHandle: null });
    graph.begin(null);
  }
  return {
    isValidConnection,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onClickConnectStart: onConnectStart,
    onClickConnectEnd: onConnectEnd,
    cancel,
  };
}

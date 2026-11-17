import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "./plan-flow-context";
import { PlanFlowHandle } from "./plan-flow-handle";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { planInTargetClass } from "./plan-flow-ports";
import { planNodeAccent, planNodeClass } from "./plan-layout";
import { PlanNodeActions, PlanNodeEditButton } from "./plan-node-actions";
import { PlanNodeIcon } from "./plan-node-icon";
import { PlanNodeWarning } from "./plan-node-warning";
import { PLAN_NODE_ICON, PLAN_NODE_TEXT } from "./plan-node-text";
import { PlanStatusBadge, planStatusClass, planStatusKey } from "./plan-status";
import { planEndpointPorts } from "./plan-jump/plan-jump-model";
import { PlanPortGrid } from "./plan-jump/plan-jump-ports";
import { firstFilledText } from "./plan-jump/plan-jump-text";

import type {
  AgentPlanEnd,
  AgentPlanStart,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanEndpointProps {
  readonly node: AgentPlanStart | AgentPlanEnd;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly hasRun: boolean;
  readonly result?: AgentPlanStepResult;
}

/** The name of a start or end: a start may carry its own, otherwise the type names it. */
function useEndpointLabel(node: AgentPlanStart | AgentPlanEnd): string {
  const { t } = useTranslation();
  const own = firstFilledText(node.type === "start" ? node.name : undefined);
  return own || t(`plans.nodeType.${node.type}`);
}

/**
 * Compact horizontal checkpoints: the icon left of the name, the run status
 * and the menu at the right, and only their legal flow port.
 * @remarks
 * The cards keep their stored coordinates. The icon only marks the node; it
 * starts nothing. A start that other plans may call shows its accepted inputs
 * as value outputs below, an end that returns values shows one value input per
 * return; a plan without them keeps the compact pill.
 */
export function PlanEndpoint(props: PlanEndpointProps): React.ReactElement {
  const { t } = useTranslation();
  const { draft, onEdit } = usePlanFlowContext();
  const { node, graph } = props;
  const label = useEndpointLabel(node);
  const ports = planEndpointPorts(draft, node);
  const status = props.result?.status ?? "waiting";
  const statusLabel = t(planStatusKey(status, props.result?.isBlocked));
  function edit(): void {
    graph.select(node.id);
    onEdit?.(node.id);
  }
  return (
    <article
      aria-label={label}
      className={cn(
        "relative flex w-full flex-col rounded-2xl border shadow-xs",
        props.hasRun
          ? planStatusClass(status, props.result?.isBlocked)
          : planNodeClass(node.type),
        graph.selectedId === node.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-surface",
      )}
      onKeyDown={keepPlanControlKeys}
    >
      <div className="relative flex flex-1 items-center gap-1 pr-1.5">
        <button
          type="button"
          data-plan-handle={node.id}
          onClick={() => graph.select(node.id)}
          aria-label={t("plans.selectNode", { name: label })}
          title={props.hasRun ? statusLabel : label}
          className={cn(
            "flex h-full flex-1 items-center gap-2 rounded-2xl pl-3.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            PLAN_NODE_TEXT.title,
            props.canEdit && "cursor-grab active:cursor-grabbing",
          )}
        >
          <PlanNodeIcon
            type={node.type}
            className={cn(
              PLAN_NODE_ICON,
              "shrink-0",
              !props.hasRun && planNodeAccent(node.type),
            )}
          />
          <span className="flex flex-col text-left">
            <span className="whitespace-nowrap">{label}</span>
            <EndpointCaption node={node} />
          </span>
        </button>
        <PlanNodeWarning nodeId={node.id} issues={graph.issues} />
        {props.hasRun ? (
          <PlanStatusBadge
            compact
            status={status}
            isBlocked={props.result?.isBlocked}
          />
        ) : null}
        <PlanNodeEditButton label={label} onEdit={edit} />
        <div className="nodrag nopan">
          <PlanNodeActions
            label={label}
            disabled={!props.canEdit}
            onRemove={() => graph.remove(node.id)}
            shouldFocusCanvasOnRemove
          />
        </div>
        <EndpointFlowPort {...props} />
      </div>
      {ports.length > 0 ? (
        <div className="px-3 pb-2">
          <PlanPortGrid
            nodeId={node.id}
            label={label}
            ports={ports}
            bindings={node.type === "end" ? node.bindings : undefined}
          />
        </div>
      ) : null}
    </article>
  );
}

/** The line under the name of a start that other plans may call. */
function EndpointCaption(props: {
  readonly node: AgentPlanStart | AgentPlanEnd;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (props.node.type !== "start" || props.node.callable !== true) return null;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-muted-foreground",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {t("plans.entry.callableShort")}
    </span>
  );
}

function EndpointFlowPort(props: PlanEndpointProps): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  const isStart = node.type === "start";
  return (
    <>
      <div className="absolute inset-x-0 top-1/2">
        <PlanFlowHandle
          id={isStart ? "flow-out" : "flow-in"}
          type={isStart ? "source" : "target"}
          kind="flow"
          style={isStart ? { right: 0 } : { left: 0 }}
        />
      </div>
      <Button
        size="xs"
        variant="ghost"
        className={cn(
          "nodrag nopan sr-only focus:not-sr-only focus:absolute focus:top-full focus:left-1/2 focus:mt-1 focus:-translate-x-1/2 focus:bg-surface",
          !isStart && planInTargetClass(graph, node.id),
        )}
        disabled={!props.canEdit}
        onClick={() =>
          isStart
            ? graph.begin({ kind: "flow", nodeId: node.id })
            : graph.connect(node.id)
        }
      >
        {t(isStart ? "plans.flowOut" : "plans.flowIn")}
      </Button>
    </>
  );
}

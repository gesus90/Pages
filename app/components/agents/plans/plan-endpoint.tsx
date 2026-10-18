import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PlanFlowHandle } from "./plan-flow-handle";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { planInTargetClass } from "./plan-flow-ports";
import { planNodeAccent, planNodeClass } from "./plan-layout";
import { PlanNodeActions } from "./plan-node-actions";
import { PlanNodeIcon } from "./plan-node-icon";
import { PlanStatusBadge, planStatusClass } from "./plan-status";

import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanEndpointProps {
  readonly node: AgentPlanNode;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly hasRun: boolean;
  readonly result?: AgentPlanStepResult;
}

/**
 * Compact horizontal checkpoints: the icon left of the name, the run status
 * and the menu at the right, and only their legal flow port.
 *
 * @remarks
 * The cards keep their stored coordinates. The icon only marks the node; it
 * starts nothing.
 */
export function PlanEndpoint(props: PlanEndpointProps): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  const label = t(`plans.nodeType.${node.type}`);
  const status = props.result?.status ?? "waiting";
  const statusLabel = t(
    props.result?.isBlocked ? "plans.blocked" : `plans.status.${status}`,
  );
  return (
    <article
      aria-label={label}
      className={cn(
        "relative flex w-full items-center gap-1 rounded-2xl border pr-1.5 shadow-xs",
        props.hasRun
          ? planStatusClass(status, props.result?.isBlocked)
          : planNodeClass(node.type),
        graph.selectedId === node.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-surface",
        graph.issues.some((issue) => issue.nodeId === node.id) &&
          "border-destructive",
      )}
      onKeyDown={keepPlanControlKeys}
    >
      <button
        type="button"
        data-plan-handle={node.id}
        onClick={() => graph.select(node.id)}
        aria-label={t("plans.selectNode", { name: label })}
        title={props.hasRun ? statusLabel : label}
        className={cn(
          "flex h-full flex-1 items-center gap-2 rounded-2xl pl-3.5 text-base font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          props.canEdit && "cursor-grab active:cursor-grabbing",
        )}
      >
        <PlanNodeIcon
          type={node.type}
          className={cn(
            "size-5 shrink-0",
            !props.hasRun && planNodeAccent(node.type),
          )}
        />
        <span className="whitespace-nowrap">{label}</span>
      </button>
      {props.hasRun ? (
        <PlanStatusBadge
          compact
          status={status}
          isBlocked={props.result?.isBlocked}
        />
      ) : null}
      <div className="nodrag nopan">
        <PlanNodeActions
          label={label}
          disabled={!props.canEdit}
          onRemove={() => graph.remove(node.id)}
          shouldFocusCanvasOnRemove
        />
      </div>
      <EndpointFlowPort {...props} />
    </article>
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

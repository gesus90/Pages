import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PlanFlowHandle } from "./plan-flow-handle";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { planInTargetClass } from "./plan-flow-ports";
import { planNodeClass } from "./plan-layout";
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

/** Rounded checkpoints retain their stored coordinates and expose only their legal flow direction. */
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
        "relative size-full rounded-3xl border shadow-sm",
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
      <div className="nodrag nopan absolute top-1.5 right-1.5">
        <PlanNodeActions
          label={label}
          disabled={!props.canEdit}
          onRemove={() => graph.remove(node.id)}
          removeLabel={t("plans.removeEndpoint")}
          shouldFocusCanvasOnRemove
        />
      </div>
      <button
        type="button"
        data-plan-handle={node.id}
        onClick={() => graph.select(node.id)}
        aria-label={t("plans.selectNode", { name: label })}
        title={props.hasRun ? statusLabel : label}
        className={cn(
          "flex size-full items-center gap-3 rounded-3xl px-6 text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          props.canEdit && "cursor-grab active:cursor-grabbing",
        )}
      >
        <PlanNodeIcon type={node.type} className="size-6 shrink-0" />
        {label}
      </button>
      {props.hasRun ? (
        <div className="pointer-events-none absolute bottom-2 left-6">
          <PlanStatusBadge
            isConcise
            status={status}
            isBlocked={props.result?.isBlocked}
          />
        </div>
      ) : null}
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

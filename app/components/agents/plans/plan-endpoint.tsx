import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PlanFlowHandle } from "./plan-flow-handle";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { planInTargetClass } from "./plan-flow-ports";
import { PlanNodeActions } from "./plan-node-actions";
import { PlanNodeIcon } from "./plan-node-icon";
import { planStatusClass } from "./plan-status";

import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Compact checkpoints retain their stored coordinates and expose only their legal flow direction. */
export function PlanEndpoint(props: {
  readonly node: AgentPlanNode;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly result?: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  const label = t(`plans.nodeType.${node.type}`);
  const isStart = node.type === "start";
  const status = props.result?.status === "succeeded" ? "succeeded" : "waiting";
  return (
    <article
      aria-label={label}
      className="size-full"
      onKeyDown={keepPlanControlKeys}
    >
      <div className="nodrag nopan flex h-10 justify-end">
        <PlanNodeActions
          label={label}
          disabled={!props.canEdit}
          onRemove={() => graph.remove(node.id)}
        />
      </div>
      <button
        type="button"
        data-plan-handle={node.id}
        onClick={() => graph.select(node.id)}
        aria-label={t("plans.selectNode", { name: label })}
        title={t(`plans.status.${status}`)}
        className={cn(
          "flex size-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-semibold shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          props.canEdit && "cursor-grab active:cursor-grabbing",
          planStatusClass(status),
          graph.selectedId === node.id &&
            "ring-2 ring-info ring-offset-2 ring-offset-surface",
          graph.issues.some((issue) => issue.nodeId === node.id) &&
            "border-destructive",
        )}
      >
        <PlanNodeIcon type={node.type} />
        {label}
      </button>
      <div className="absolute inset-x-0 top-[72px]">
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
          "nodrag nopan absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px]",
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
    </article>
  );
}

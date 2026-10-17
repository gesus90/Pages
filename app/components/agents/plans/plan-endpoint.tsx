import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PLAN_ENDPOINT_SIZE } from "./plan-layout";
import { planInTargetClass } from "./plan-flow-ports";
import { PlanNodeActions } from "./plan-node-actions";
import { planStatusClass } from "./plan-status";

import type {
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** A small movable checkpoint: its circle moves it, start offers the flow OUT and end the flow IN. */
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
  const Icon = isStart ? ArrowRight : ArrowLeft;
  return (
    <article
      aria-label={label}
      className="absolute"
      style={{
        left: node.x,
        top: node.y,
        width: PLAN_ENDPOINT_SIZE,
        height: 104,
      }}
    >
      <div className="flex h-10 justify-end">
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
          "flex size-16 items-center justify-center rounded-full border text-xs font-semibold",
          props.canEdit && "cursor-grab active:cursor-grabbing",
          planStatusClass(status),
          graph.selectedId === node.id &&
            "ring-2 ring-info ring-offset-2 ring-offset-surface",
          graph.issues.some((issue) => issue.nodeId === node.id) &&
            "border-destructive",
        )}
      >
        {label}
      </button>
      <Button
        size="icon-sm"
        variant="outline"
        data-plan-out={isStart ? node.id : undefined}
        data-plan-out-kind={isStart ? "flow" : undefined}
        data-plan-in={isStart ? undefined : node.id}
        className={cn(
          "absolute top-14 size-8 rounded-full",
          isStart ? "-right-4 cursor-crosshair" : "-left-4",
          !isStart && planInTargetClass(graph, node.id),
        )}
        aria-label={t(isStart ? "plans.flowOut" : "plans.flowIn")}
        disabled={!props.canEdit || (!isStart && !graph.connection)}
        onClick={() =>
          isStart
            ? graph.begin({ kind: "flow", nodeId: node.id })
            : graph.connect(node.id)
        }
      >
        <Icon className="size-3" aria-hidden="true" />
      </Button>
    </article>
  );
}

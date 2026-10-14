import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import {
  PLAN_NODE_WIDTH,
  planNodeClass,
  planNodeHeight,
  planNodeLabel,
} from "./plan-layout";
import { PlanPorts } from "./plan-ports";
import { PlanFlowPorts } from "./plan-flow-ports";

import type {
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Node ports are buttons as well as drag targets, allowing keyboard and touch bindings. */
export function PlanNodeCard(props: {
  readonly node: AgentPlanNode;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly result?: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  const label =
    node.type === "start" || node.type === "end"
      ? t(`plans.nodeType.${node.type}`)
      : planNodeLabel(node, props.sources) || t("plans.missingAgent");
  const parameters =
    node.type === "agent"
      ? (props.sources.agents.find((agent) => agent.id === node.agentId)
          ?.configuration.parameters ?? [])
      : [];
  function startDrag(event: React.DragEvent<HTMLButtonElement>): void {
    event.dataTransfer.setData("application/x-pages-plan", `node:${node.id}`);
    event.dataTransfer.effectAllowed = "move";
  }
  return (
    <article
      aria-label={label}
      className={cn(
        "absolute rounded-xl border p-3 shadow-xs",
        planNodeClass(node.type),
        graph.selectedId === node.id && "ring-2 ring-primary",
        graph.issues.some((issue) => issue.nodeId === node.id) &&
          "border-destructive",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: PLAN_NODE_WIDTH,
        height: planNodeHeight(node, props.sources),
      }}
    >
      <button
        type="button"
        draggable={props.canEdit}
        onDragStart={startDrag}
        onClick={() => graph.select(node.id)}
        className="mb-2 h-9 w-full cursor-grab text-left text-sm font-semibold"
        aria-label={t("plans.selectNode", {
          name: label,
        })}
      >
        <span className="block text-xs font-normal text-muted-foreground">
          {t(`plans.nodeType.${node.type}`)}
          {props.result ? ` · ${t(`plans.status.${props.result.status}`)}` : ""}
        </span>
        <span className="block truncate">{label}</span>
      </button>
      <PlanFlowPorts node={node} graph={graph} canEdit={props.canEdit} />
      {node.type === "agent" ? (
        <PlanPorts
          node={node}
          label={label}
          parameters={parameters}
          graph={graph}
          canEdit={props.canEdit}
        />
      ) : null}
      {node.type !== "start" && node.type !== "end" ? (
        <Button
          className="mt-2 ml-auto flex"
          size="sm"
          variant="ghost"
          disabled={!props.canEdit}
          onClick={() =>
            graph.begin({
              kind: node.type === "agent" ? "result" : "source",
              nodeId: node.id,
            })
          }
        >
          {t(node.type === "agent" ? "plans.resultOut" : "plans.valueOut")}
        </Button>
      ) : null}
    </article>
  );
}

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

import type { AgentPlanNode, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Node ports are buttons as well as drag targets, allowing keyboard and touch bindings. */
export function PlanNodeCard(props: {
  readonly node: AgentPlanNode;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
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
      aria-label={planNodeLabel(node, props.sources)}
      className={cn(
        "absolute rounded-xl border p-3 shadow-xs",
        planNodeClass(node.type),
        graph.selectedId === node.id && "ring-2 ring-primary",
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
          name: planNodeLabel(node, props.sources),
        })}
      >
        <span className="block text-xs font-normal text-muted-foreground">
          {t(`plans.nodeType.${node.type}`)}
        </span>
        <span className="block truncate">
          {planNodeLabel(node, props.sources)}
        </span>
      </button>
      {node.type === "agent" ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit || graph.connection?.kind !== "flow"}
            onClick={() => graph.connect(node.id)}
          >
            {t("plans.flowIn")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.canEdit}
            onClick={() => graph.begin({ kind: "flow", nodeId: node.id })}
          >
            {t("plans.flowOut")}
          </Button>
        </div>
      ) : null}
      {node.type === "agent" ? (
        <PlanPorts
          node={node}
          label={planNodeLabel(node, props.sources)}
          parameters={parameters}
          graph={graph}
          canEdit={props.canEdit}
        />
      ) : null}
      <Button
        className="mt-2"
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
    </article>
  );
}

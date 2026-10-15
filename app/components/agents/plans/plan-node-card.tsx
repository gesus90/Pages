import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planNodeParameters } from "@/definition/AgentPlanGroup";
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

// The one data OUT of each node type; start and end have none.
const OUTPUT_LABELS: Partial<Record<AgentPlanNode["type"], string>> = {
  agent: "plans.resultOut",
  task: "plans.ticketOut",
  parameter: "plans.valueOut",
  variable: "plans.valueOut",
};

interface NodeCardProps {
  readonly node: AgentPlanNode;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly result?: AgentPlanStepResult;
  readonly onEdit?: (id: string) => void;
}

/** Node ports are buttons as well as drag targets, allowing keyboard and touch bindings. */
export function PlanNodeCard(props: NodeCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  const label =
    node.type === "start" || node.type === "end"
      ? t(`plans.nodeType.${node.type}`)
      : planNodeLabel(node, props.sources) || t("plans.missingAgent");
  const parameters = planNodeParameters(node, props.sources.agents);
  const output = OUTPUT_LABELS[node.type];
  return (
    <article
      onDoubleClick={() => {
        if (node.type === "agent" || node.type === "group") {
          graph.select(node.id);
          props.onEdit?.(node.id);
        }
      }}
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
      <NodeHeader {...props} label={label} />
      <PlanFlowPorts node={node} graph={graph} canEdit={props.canEdit} />
      {node.type === "agent" || node.type === "group" ? (
        <PlanPorts
          node={node}
          label={label}
          parameters={parameters}
          graph={graph}
          canEdit={props.canEdit}
        />
      ) : null}
      {output ? (
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
          {t(output)}
        </Button>
      ) : null}
    </article>
  );
}

function NodeHeader(
  props: NodeCardProps & { readonly label: string },
): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  function startDrag(event: React.DragEvent<HTMLButtonElement>): void {
    event.dataTransfer.setData("application/x-pages-plan", `node:${node.id}`);
    event.dataTransfer.effectAllowed = "move";
  }
  return (
    <div className="mb-2 flex h-9 items-center gap-1">
      <button
        type="button"
        draggable={props.canEdit}
        onDragStart={startDrag}
        onClick={() => graph.select(node.id)}
        className="h-9 min-w-0 flex-1 cursor-grab text-left text-sm font-semibold"
        aria-label={t("plans.selectNode", { name: props.label })}
      >
        <span className="block text-xs font-normal text-muted-foreground">
          {t(`plans.nodeType.${node.type}`)}
          {props.result ? ` · ${t(`plans.status.${props.result.status}`)}` : ""}
        </span>
        <span className="block truncate">{props.label}</span>
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        disabled={!props.canEdit}
        aria-label={t("plans.deleteNode", { name: props.label })}
        onClick={() => graph.remove(node.id)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

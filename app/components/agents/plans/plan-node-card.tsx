import { useTranslation } from "react-i18next";

import { planNodeParameters } from "@/definition/AgentPlanGroup";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { WORKFLOW_STATUS_KEY } from "@/definition/Task";

import {
  PLAN_NODE_WIDTH,
  planNodeClass,
  planNodeHeight,
  planNodeLabel,
} from "./plan-layout";
import { startPlanNodeDrag } from "./plan-drag";
import { PlanPorts } from "./plan-ports";
import { PlanFlowPorts } from "./plan-flow-ports";
import { PlanEndpoint } from "./plan-endpoint";
import { PlanNodeActions } from "./plan-node-actions";
import { PlanStatusBadge } from "./plan-status";

import type {
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStepResult,
  AgentPlanStepStatus,
  AgentPlanTask,
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
  /** Where the card is drawn; a member's own position counts from its frame. */
  readonly position?: AgentPlanPosition;
  /** Called when the card starts to be dragged, for drop targets on the grid. */
  readonly onDragNode?: (id: string) => void;
}

function ticketStatus(
  task: AgentPlanTask | null | undefined,
): AgentPlanStepStatus {
  if (task?.isDone) return "succeeded";
  if (task?.statusKey === WORKFLOW_STATUS_KEY.IN_PROGRESS) return "running";
  if (task?.statusKey === "failed") return "failed";
  return "waiting";
}

/** Node ports are buttons as well as drag targets, allowing keyboard and touch bindings. */
export function PlanNodeCard(props: NodeCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  if (node.type === "start" || node.type === "end")
    return <PlanEndpoint {...props} />;
  const label = planNodeLabel(node, props.sources) || t("plans.missingAgent");
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
        graph.selectedId === node.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-surface",
        graph.issues.some((issue) => issue.nodeId === node.id) &&
          "border-destructive",
      )}
      style={{
        left: props.position?.x ?? node.x,
        top: props.position?.y ?? node.y,
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
  const task =
    node.type === "task"
      ? props.sources.tasks.find((entry) => entry.id === node.taskId)
      : null;
  const status = props.result?.status ?? ticketStatus(task);
  function edit(): void {
    graph.select(node.id);
    if (node.type === "agent" || node.type === "group") props.onEdit?.(node.id);
  }
  function startDrag(event: React.DragEvent<HTMLButtonElement>): void {
    startPlanNodeDrag(event, node);
    props.onDragNode?.(node.id);
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
        <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
          {t(`plans.nodeType.${node.type}`)}
        </span>
        <span className="block truncate">{props.label}</span>
      </button>
      {props.result || task ? (
        <PlanStatusBadge
          compact
          status={status}
          isBlocked={props.result?.isBlocked}
        />
      ) : null}
      <PlanNodeActions
        label={props.label}
        disabled={!props.canEdit}
        onRemove={() => graph.remove(node.id)}
        onEdit={node.type === "task" ? undefined : edit}
      />
    </div>
  );
}

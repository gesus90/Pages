import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { planNodeParameters } from "@/definition/AgentPlanGroup";
import { WORKFLOW_STATUS_KEY } from "@/definition/Task";

import { usePlanFlowContext } from "./plan-flow-context";
import { PlanFlowHandle } from "./plan-flow-handle";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { PlanFlowPorts } from "./plan-flow-ports";
import { PlanEndpoint } from "./plan-endpoint";
import { PlanGroupFrame } from "./plan-group-frame";
import { planRunGroupSession } from "./plan-group-session";
import { planNodeClass, planNodeLabel } from "./plan-layout";
import { PlanNodeActions } from "./plan-node-actions";
import { PlanNodeIcon } from "./plan-node-icon";
import { PlanPorts } from "./plan-ports";
import { PlanStatusBadge, planStatusClass } from "./plan-status";
import { usePlanFlowPorts } from "./use-plan-flow-ports";

import type { NodeProps } from "@xyflow/react";
import type {
  AgentPlanNode,
  AgentPlanStepStatus,
  AgentPlanTask,
} from "@/definition/AgentPlan";
import type { PlanFlowNode } from "./plan-flow-model";

const OUTPUT_LABELS: Partial<Record<AgentPlanNode["type"], string>> = {
  agent: "plans.resultOut",
  task: "plans.ticketOut",
  parameter: "plans.valueOut",
  variable: "plans.valueOut",
};

function ticketStatus(
  task: AgentPlanTask | null | undefined,
): AgentPlanStepStatus {
  if (task?.isDone) return "succeeded";
  if (task?.statusKey === WORKFLOW_STATUS_KEY.IN_PROGRESS) return "running";
  if (task?.statusKey === "failed") return "failed";
  return "waiting";
}

/** Custom React Flow cards retain the Pages instance, ports and recorded run states. */
export function PlanNodeCard({
  data: { node },
}: NodeProps<PlanFlowNode>): React.ReactElement {
  const { t } = useTranslation();
  const context = usePlanFlowContext();
  const { sources, graph, canEdit, run } = context;
  usePlanFlowPorts(node, sources);
  const result = run?.steps.find((step) => step.id === node.id);
  if (node.type === "start" || node.type === "end")
    return (
      <PlanEndpoint
        node={node}
        graph={graph}
        canEdit={canEdit}
        hasRun={run !== null}
        result={result}
      />
    );
  if (node.type === "group")
    return (
      <PlanGroupFrame
        {...context}
        group={node}
        isDropTarget={context.dropTarget === node.id}
        session={planRunGroupSession(run, node.id)}
        result={result}
        hasRun={run !== null}
      />
    );
  const label = planNodeLabel(node, sources) || t("plans.missingAgent");
  const output = OUTPUT_LABELS[node.type];
  return (
    <article
      aria-label={label}
      onKeyDown={keepPlanControlKeys}
      className={cn(
        "size-full rounded-xl border shadow-sm transition-shadow",
        run
          ? planStatusClass(result?.status ?? "waiting", result?.isBlocked)
          : planNodeClass(node.type),
        graph.selectedId === node.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-surface",
        graph.issues.some((issue) => issue.nodeId === node.id) &&
          "border-destructive",
      )}
    >
      <NodeHeader node={node} label={label} />
      <div className="px-3 pt-2">
        <PlanFlowPorts node={node} graph={graph} canEdit={canEdit} />
        {node.type === "agent" ? (
          <PlanPorts
            node={node}
            label={label}
            parameters={planNodeParameters(node, sources.agents)}
            graph={graph}
            canEdit={canEdit}
          />
        ) : null}
        {output ? (
          <div className="relative mt-2 flex h-8 justify-end">
            <Button
              className="nodrag nopan h-7 min-h-7 cursor-crosshair gap-1 text-xs text-plan-parameter xl:min-h-7"
              size="sm"
              variant="ghost"
              disabled={!canEdit}
              onClick={() =>
                graph.begin({
                  kind: node.type === "agent" ? "result" : "source",
                  nodeId: node.id,
                })
              }
            >
              {t(output)}
              <span aria-hidden="true">◇</span>
            </Button>
            <PlanFlowHandle id="value-out" type="source" kind="data" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function NodeHeader(props: {
  readonly node: AgentPlanNode;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources, graph, canEdit, run, onEdit } = usePlanFlowContext();
  const { node } = props;
  const result = run?.steps.find((step) => step.id === node.id);
  const task =
    node.type === "task"
      ? sources.tasks.find((entry) => entry.id === node.taskId)
      : null;
  function edit(): void {
    graph.select(node.id);
    if (node.type === "agent") onEdit?.(node.id);
  }
  return (
    <header className="flex h-14 items-center gap-2 border-b border-border px-3">
      <PlanNodeIcon
        type={node.type}
        className="size-5 shrink-0 text-muted-foreground"
      />
      <button
        type="button"
        data-plan-handle={node.id}
        onClick={() => graph.select(node.id)}
        className={cn(
          "min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          canEdit && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={t("plans.selectNode", { name: props.label })}
        title={props.label}
      >
        <span className="block text-[11px] font-medium tracking-wide text-muted-foreground">
          {t(`plans.nodeType.${node.type}`)}
        </span>
        <span className="block truncate text-sm font-semibold">
          {props.label}
        </span>
      </button>
      {run || task ? (
        <PlanStatusBadge
          compact
          status={run ? (result?.status ?? "waiting") : ticketStatus(task)}
          isBlocked={result?.isBlocked}
        />
      ) : null}
      <div className="nodrag nopan">
        <PlanNodeActions
          label={props.label}
          disabled={!canEdit}
          onRemove={() => graph.remove(node.id)}
          onEdit={node.type === "agent" ? edit : undefined}
        />
      </div>
    </header>
  );
}

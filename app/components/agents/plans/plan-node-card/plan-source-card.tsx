import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";
import { PlanCard } from "./plan-card";
import { PlanParameterFields } from "./plan-parameter-fields";
import { PlanValueInput } from "./plan-value-input";
import { PlanValueOut } from "./plan-value-out";

import type { AgentPlanNode, AgentPlanTask } from "@/definition/AgentPlan";

type PlanSourceNode = Extract<
  AgentPlanNode,
  { type: "parameter" | "task" | "variable" }
>;
type PlanTicketNode = Extract<AgentPlanNode, { type: "task" }>;
type PlanVariableNode = Extract<AgentPlanNode, { type: "variable" }>;

/**
 * Cards of value sources: violet parameters, yellow tickets and variables.
 *
 * @remarks
 * Sources never run, so they keep their type colors and show no run status
 * while a run is shown.
 */
export function PlanSourceCard(props: {
  readonly node: PlanSourceNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  const { node } = props;
  const label = planNodeLabel(node, sources);
  if (node.type === "parameter")
    return (
      <PlanCard node={node} label={label} title={t("plans.nodeType.parameter")}>
        <PlanParameterFields node={node} />
      </PlanCard>
    );
  if (node.type === "task")
    return (
      <PlanCard node={node} label={label} title={t("plans.ticketsCard")}>
        <TicketFields node={node} />
      </PlanCard>
    );
  return (
    <PlanCard
      node={node}
      label={label}
      title={node.name}
      subtitle={t("plans.nodeType.variable")}
    >
      <VariableFields node={node} />
    </PlanCard>
  );
}

/**
 * One ticket reference of the plan's project; choosing another one changes
 * only this node, never a ticket.
 */
function TicketFields(props: {
  readonly node: PlanTicketNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources, graph, canEdit } = usePlanFlowContext();
  const { node } = props;
  const task = sources.tasks.find((entry) => entry.id === node.taskId);
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3">
      <div className="relative grid h-8 grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {t("plans.field.ticket")}
        </span>
        <PlanValueInput
          type="ticket"
          value={{ type: "ticket", ticketId: node.taskId }}
          label={t("plans.ticketChoice")}
          hasIssue={!task}
          disabled={!canEdit}
          onChange={(value) => {
            if (value.type === "ticket" && value.ticketId)
              graph.replaceNode({ ...node, taskId: value.ticketId });
          }}
        />
        <PlanValueOut nodeId={node.id} labelKey="plans.ticketOut" />
      </div>
      <TicketSummary task={task} />
    </div>
  );
}

/** The chosen ticket's title and workflow status, apart from any run status. */
function TicketSummary(props: {
  readonly task: AgentPlanTask | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { task } = props;
  if (!task)
    return (
      <p className="flex h-5 min-w-0 items-center gap-1.5 text-xs text-destructive">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" title={t("plans.ticketUnavailableHint")}>
          {t("plans.ticketUnavailableHint")}
        </span>
      </p>
    );
  return (
    <p className="flex h-5 min-w-0 items-center gap-2 text-xs">
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={`${task.key}: ${task.title}`}
      >
        {task.title}
      </span>
      <span
        className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-[11px] leading-4 text-muted-foreground"
        title={t("plans.ticketWorkflowStatus", { status: task.statusName })}
      >
        {task.statusName}
      </span>
    </p>
  );
}

/** A plan variable sends its global value; its name is edited with the plan's variables. */
function VariableFields(props: {
  readonly node: PlanVariableNode;
}): React.ReactElement {
  const { draft } = usePlanFlowContext();
  const value = draft.globals[props.node.name] ?? "";
  return (
    <div className="px-3 pb-3">
      <div className="relative flex h-8 items-center">
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={value}
        >
          {value}
        </span>
        <PlanValueOut nodeId={props.node.id} labelKey="plans.valueOut" />
      </div>
    </div>
  );
}

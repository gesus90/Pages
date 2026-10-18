import { useTranslation } from "react-i18next";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";
import { PlanCard } from "./plan-card";
import { PlanParameterFields } from "./plan-parameter-fields";
import { PlanTicketPicker } from "./plan-ticket-picker";
import { PlanValueOut } from "./plan-value-out";

import type { AgentPlanNode, AgentPlanSources } from "@/definition/AgentPlan";

type PlanSourceNode = Extract<
  AgentPlanNode,
  { type: "parameter" | "task" | "variable" }
>;
type PlanTicketNode = Extract<AgentPlanNode, { type: "task" }>;
type PlanVariableNode = Extract<AgentPlanNode, { type: "variable" }>;

/** The ticket's key and title; a ticket that is gone is named, not identified. */
function ticketLabel(
  node: PlanTicketNode,
  sources: AgentPlanSources,
  unavailable: string,
): string {
  const task = sources.tasks.find((entry) => entry.id === node.taskId);
  return task ? `${task.key}: ${task.title}` : unavailable;
}

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
      <PlanCard
        node={node}
        label={ticketLabel(node, sources, t("plans.ticketUnavailable"))}
        title={t("plans.ticketsCard")}
        size="large"
      >
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
  const { graph, canEdit } = usePlanFlowContext();
  const { node } = props;
  return (
    <div className="px-3 pb-[0.9375rem]">
      {/* The row keeps the card's 12 px inset, so its data OUT sits on the edge. */}
      <div className="relative grid h-8 grid-cols-[3.125rem_minmax(0,1fr)] items-center gap-2 px-1">
        <span className="truncate text-[13px] text-foreground">
          {t("plans.field.ticket")}
        </span>
        <PlanTicketPicker
          taskId={node.taskId}
          label={t("plans.ticketChoice")}
          disabled={!canEdit}
          onSelect={(taskId) => graph.replaceNode({ ...node, taskId })}
        />
        <PlanValueOut nodeId={node.id} labelKey="plans.ticketOut" />
      </div>
    </div>
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

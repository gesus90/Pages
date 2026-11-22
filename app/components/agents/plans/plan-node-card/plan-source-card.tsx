import { useTranslation } from "react-i18next";

import { usePlanFlowContext } from "../plan-flow-context";
import { cn } from "@/app/lib/cn";

import { planNodeLabel } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanCard, PlanCardColumns, PLAN_CARD_BODY } from "./plan-card";
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
 * @remarks
 * Sources never run, so they show no status marker while a run is shown.
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
      <PlanCard
        node={node}
        label={label}
        title={t("plans.nodeType.parameter")}
        subtitle={t("plans.nodeType.parameter")}
      >
        <PlanParameterFields node={node} />
      </PlanCard>
    );
  if (node.type === "task")
    return (
      <PlanCard
        node={node}
        label={ticketLabel(node, sources, t("plans.ticketUnavailable"))}
        title={t("plans.ticketsCard")}
        subtitle={t("plans.nodeType.task")}
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
    <div className={PLAN_CARD_BODY}>
      <PlanCardColumns
        inputs={
          <div className="grid h-8 grid-cols-[2.75rem_minmax(0,6.5rem)] items-center gap-1">
            <span
              className={cn(
                "truncate text-muted-foreground",
                PLAN_NODE_TEXT.field,
              )}
            >
              {t("plans.field.ticket")}
            </span>
            <PlanTicketPicker
              taskId={node.taskId}
              label={t("plans.ticketChoice")}
              disabled={!canEdit}
              onSelect={(taskId) => graph.replaceNode({ ...node, taskId })}
            />
          </div>
        }
        outputs={
          <PlanValueOut
            nodeId={node.id}
            labelKey="plans.ticketOut"
            textKey="plans.field.ticket"
          />
        }
      />
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
    <div className={PLAN_CARD_BODY}>
      <PlanCardColumns
        inputs={
          <span
            className={cn(
              "flex h-8 min-w-0 items-center truncate text-muted-foreground",
              PLAN_NODE_TEXT.field,
            )}
            title={value}
          >
            {value}
          </span>
        }
        outputs={
          <PlanValueOut
            nodeId={props.node.id}
            labelKey="plans.valueOut"
            textKey="plans.valueOut"
          />
        }
      />
    </div>
  );
}

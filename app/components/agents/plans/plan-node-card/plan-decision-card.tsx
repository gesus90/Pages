import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  PLAN_PORT,
  planConditionSource,
} from "@/definition/AgentPlanBranching";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { planAgentName, planNodeLabel } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanStatusBadge, planRunCardClass } from "../plan-status";
import { PlanCard } from "./plan-card";
import { PlanDecisionOutput } from "./plan-decision-output";
import { PlanRunNotes } from "./plan-run-notes";

import type {
  AgentPlanDecision,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/** The agent whose boolean result a decision reads, named for the chip; empty without exactly one. */
function useConditionName(decision: AgentPlanDecision): string | null {
  const { t } = useTranslation();
  const { draft, sources } = usePlanFlowContext();
  const sourceId = planConditionSource(draft, decision.id);
  if (sourceId === null) return null;
  const source = draft.nodes.find((node) => node.id === sourceId);
  if (source?.type !== "agent") return t("plans.missingAgent");
  return planAgentName(source, sources) || t("plans.missingAgent");
}

/** The input of a decision: its condition port, and the type of what it takes. */
function DecisionConditionIn(props: {
  readonly decision: AgentPlanDecision;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { decision } = props;
  const hasIssue = graph.issues.some(
    (issue) =>
      issue.nodeId === decision.id && issue.port === PLAN_PORT.conditionIn,
  );
  return (
    <div className="relative flex h-8 items-center justify-between gap-2">
      <PlanFlowHandle
        id={PLAN_PORT.conditionIn}
        type="target"
        kind="logic"
        hasIssue={hasIssue}
      />
      <button
        type="button"
        data-plan-in={decision.id}
        data-plan-port={PLAN_PORT.conditionIn}
        className={cn(
          "nodrag nopan -ml-1.25 flex h-7 min-w-0 items-center rounded-md border border-transparent px-1 text-left font-medium hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
          PLAN_NODE_TEXT.field,
          hasIssue && "text-destructive",
          planInTargetClass(graph, decision.id, PLAN_PORT.conditionIn),
        )}
        aria-label={t("plans.decision.conditionLabel", { name: props.label })}
        disabled={!canEdit}
        onClick={() => graph.connect(decision.id, PLAN_PORT.conditionIn)}
      >
        <span className="truncate">{t("plans.decision.condition")}</span>
      </button>
      <span
        className={cn(
          "shrink-0 rounded-md border border-plan-logic-edge/60 bg-plan-logic/10 px-2 py-0.5 font-medium text-plan-logic",
          PLAN_NODE_TEXT.meta,
        )}
      >
        {t("plans.decision.boolean")}
      </span>
    </div>
  );
}

/** What the decision reads, in plain words: the agent and its result, or that nothing is connected. */
function DecisionBinding(props: {
  readonly decision: AgentPlanDecision;
}): React.ReactElement {
  const { t } = useTranslation();
  const name = useConditionName(props.decision);
  const text =
    name === null
      ? t("plans.decision.notConnected")
      : t("plans.decision.reads", { name });
  return (
    <p
      data-plan-condition={name === null ? "none" : "agent"}
      title={text}
      className={cn(
        "truncate rounded-md border border-dashed px-2 py-1",
        PLAN_NODE_TEXT.field,
        name === null
          ? "border-border text-muted-foreground"
          : "border-plan-logic-edge/60 text-foreground",
      )}
    >
      {text}
    </p>
  );
}

/** The footer: that only one output is activated, and what the shown run evaluated. */
function DecisionFooter(props: {
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, sources, run } = usePlanFlowContext();
  const condition = props.result?.condition;
  const source = condition
    ? draft.nodes.find((node) => node.id === condition.sourceStepId)
    : undefined;
  const name = source
    ? planNodeLabel(source, sources)
    : (run?.steps.find((step) => step.id === condition?.sourceStepId)?.name ??
      t("plans.run.unknownNode"));
  return (
    <footer
      className={cn(
        "border-t border-plan-logic-edge/30 px-3 py-2 text-muted-foreground",
        PLAN_NODE_TEXT.meta,
      )}
    >
      <p>{t("plans.decision.footer")}</p>
      {condition ? (
        <p
          data-plan-evaluated={String(condition.value)}
          className="text-foreground"
        >
          {t("plans.decision.evaluated", {
            name,
            number: condition.sourceActivation,
            value: t(
              condition.value ? "plans.run.passed" : "plans.run.notPassed",
            ),
          })}
        </p>
      ) : null}
    </footer>
  );
}

/**
 * The Decision node: a compact logic card with one condition input and two
 * outputs, of which exactly one is activated each time it is evaluated.
 *
 * @remarks
 * It is no agent and calls no model. The card names what it reads, its two
 * outputs by word as well as colour, and, while a run is shown, which output
 * the run took.
 */
export function PlanDecisionCard(props: {
  readonly decision: AgentPlanDecision;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, onEdit } = usePlanFlowContext();
  const { decision, result } = props;
  const name = decision.name?.trim() ?? "";
  const label = name === "" ? t("plans.nodeType.decision") : name;
  function edit(): void {
    graph.select(decision.id);
    onEdit?.(decision.id);
  }
  return (
    <PlanCard
      node={decision}
      label={label}
      title={label}
      subtitle={t("plans.decision.caption")}
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={
        props.hasRun ? (
          <PlanStatusBadge compact status={result?.status ?? "waiting"} />
        ) : null
      }
      onEdit={edit}
    >
      <div
        data-plan-decision={decision.id}
        className="flex flex-col gap-1.5 px-3 pt-1 pb-2"
      >
        <PlanRunNotes result={result} />
        <DecisionConditionIn decision={decision} label={label} />
        <DecisionBinding decision={decision} />
        {(["true", "false"] as const).map((branch) => (
          <PlanDecisionOutput
            key={branch}
            decision={decision}
            branch={branch}
            label={label}
            taken={result?.branch}
          />
        ))}
      </div>
      <DecisionFooter result={result} />
    </PlanCard>
  );
}

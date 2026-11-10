import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT, planEdgeBranch } from "@/definition/AgentPlanBranching";
import {
  planDecisionCasePort,
  planDecisionMode,
  planDecisionOutput,
  planDecisionOutputPorts,
} from "@/definition/AgentPlanDecision";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanStatusBadge, planRunCardClass } from "../plan-status";
import { PlanCard } from "./plan-card";
import { PlanDecisionFooter } from "./plan-decision-footer";
import { PlanDecisionOutput } from "./plan-decision-output";
import { PlanRunNotes } from "./plan-run-notes";
import { usePlanDecisionSource } from "./use-plan-decision-source";

import type {
  AgentPlanDecision,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/** How the card names what a decision reads, by kind of source. */
const READS_KEYS = {
  passed: "plans.decision.reads",
  parameter: "plans.decision.readsParameter",
  ticket: "plans.decision.readsTicket",
  result: "plans.decision.readsResult",
} as const;

function useHasIssue(decision: AgentPlanDecision, port: string): boolean {
  const { graph } = usePlanFlowContext();
  return graph.issues.some(
    (issue) => issue.nodeId === decision.id && issue.port === port,
  );
}

/**
 * The sequence input of a decision: when the flow reaches it, it decides.
 *
 * @remarks
 * It is drawn like the flow IN of every other node, so it never looks like
 * the data input below it.
 */
function DecisionSequenceIn(props: {
  readonly decision: AgentPlanDecision;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { decision } = props;
  const hasIssue = useHasIssue(decision, PLAN_PORT.flowIn);
  return (
    <div className="relative flex h-7 items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        data-plan-in={decision.id}
        aria-label={t("plans.decision.sequenceLabel", { name: props.label })}
        className={cn(
          "nodrag nopan -ml-1.25 h-7 min-h-7 border-transparent bg-transparent px-1 text-xs leading-4.5 font-medium shadow-none hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7 xl:px-1 xl:text-xs",
          hasIssue && "border-destructive text-destructive",
          planInTargetClass(graph, decision.id),
        )}
        disabled={!canEdit}
        onClick={() => graph.connect(decision.id)}
      >
        {t("plans.flowInShort")}
      </Button>
      <span
        className={cn("truncate text-muted-foreground", PLAN_NODE_TEXT.meta)}
      >
        {t("plans.decision.sequence")}
      </span>
      <PlanFlowHandle
        id={PLAN_PORT.flowIn}
        type="target"
        kind="flow"
        hasIssue={hasIssue}
      />
    </div>
  );
}

/** The data input of a decision: its port, and the kind of value its mode takes. */
function DecisionConditionIn(props: {
  readonly decision: AgentPlanDecision;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { decision } = props;
  const hasIssue = useHasIssue(decision, PLAN_PORT.conditionIn);
  const isModel = planDecisionMode(decision) === "model";
  return (
    <div className="relative flex h-8 items-center justify-between gap-2">
      <PlanFlowHandle
        id={PLAN_PORT.conditionIn}
        type="target"
        kind={isModel ? "data" : "logic"}
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
        {t(isModel ? "plans.decision.content" : "plans.decision.boolean")}
      </span>
    </div>
  );
}

/** What the decision reads, in plain words: its source and its kind, or that nothing is connected. */
function DecisionBinding(props: {
  readonly decision: AgentPlanDecision;
}): React.ReactElement {
  const { t } = useTranslation();
  const source = usePlanDecisionSource(props.decision);
  const text =
    source === null
      ? t("plans.decision.notConnected")
      : t(READS_KEYS[source.kind], { name: source.name });
  return (
    <p
      data-plan-condition={source?.kind ?? "none"}
      title={text}
      className={cn(
        "truncate rounded-md border border-dashed px-2 py-1",
        PLAN_NODE_TEXT.field,
        source === null
          ? "border-border text-muted-foreground"
          : "border-plan-logic-edge/60 text-foreground",
      )}
    >
      {text}
    </p>
  );
}

/** The question and the model of a model decision. */
function DecisionModel(props: {
  readonly decision: AgentPlanDecision;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { decision } = props;
  const hasQuestionIssue = useHasIssue(decision, "question");
  const hasModelIssue = useHasIssue(decision, "model");
  if (planDecisionMode(decision) !== "model") return null;
  const question = decision.question?.trim() ?? "";
  return (
    <div className={cn("flex flex-col gap-0.5", PLAN_NODE_TEXT.meta)}>
      <p
        data-plan-question
        title={question}
        className={cn(
          "line-clamp-2 text-foreground",
          (hasQuestionIssue || question === "") && "text-destructive",
        )}
      >
        {question === "" ? t("plans.decision.noQuestion") : question}
      </p>
      <p
        className={cn(
          "truncate text-muted-foreground",
          hasModelIssue && "text-destructive",
        )}
      >
        {decision.model
          ? t("plans.decision.modelLine", { model: decision.model.model })
          : t("plans.decision.noModel")}
      </p>
    </div>
  );
}

/** The outputs of the decision: true and false, or one per value of a classification. */
function DecisionOutputs(props: {
  readonly decision: AgentPlanDecision;
  readonly label: string;
  readonly taken: AgentPlanStepResult["branch"];
}): React.ReactElement {
  const { decision } = props;
  const cases = decision.cases ?? [];
  const isClassification = planDecisionOutput(decision) === "classification";
  return (
    <>
      {planDecisionOutputPorts(decision).flatMap((port) => {
        const branch = planEdgeBranch({ fromPort: port });
        if (branch === null) return [];
        return [
          <PlanDecisionOutput
            key={port}
            decision={decision}
            branch={branch}
            label={props.label}
            caseName={
              isClassification
                ? cases.find((entry) => planDecisionCasePort(entry.id) === port)
                    ?.name
                : undefined
            }
            taken={props.taken}
          />,
        ];
      })}
    </>
  );
}

/**
 * The Decision node: a sequence input, one data input and one output per
 * answer, of which exactly one is activated each time it decides.
 *
 * @remarks
 * A boolean decision reads a boolean parameter or an agent's boolean and
 * calls no model; a model decision asks the chosen model one question about
 * a ticket or a text result (PAGE-286). While a run is shown, the card names
 * the output it took and, for a model, its answer and reason.
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
  const isModel = planDecisionMode(decision) === "model";
  function edit(): void {
    graph.select(decision.id);
    onEdit?.(decision.id);
  }
  return (
    <PlanCard
      node={decision}
      label={label}
      title={label}
      subtitle={t(
        isModel ? "plans.decision.captionModel" : "plans.decision.caption",
      )}
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
        data-plan-decision-mode={isModel ? "model" : "boolean"}
        className="flex flex-col gap-1.5 px-3 pt-1 pb-2"
      >
        <PlanRunNotes result={result} />
        <DecisionSequenceIn decision={decision} label={label} />
        <DecisionConditionIn decision={decision} label={label} />
        <DecisionBinding decision={decision} />
        <DecisionModel decision={decision} />
        <DecisionOutputs
          decision={decision}
          label={label}
          taken={result?.branch}
        />
      </div>
      <PlanDecisionFooter result={result} />
    </PlanCard>
  );
}

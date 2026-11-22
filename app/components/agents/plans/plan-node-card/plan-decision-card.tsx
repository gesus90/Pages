import { useTranslation } from "react-i18next";

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
import { PlanRunMarker, planRunCardClass } from "../plan-status";
import {
  PlanCard,
  PlanCardColumns,
  PLAN_CARD_BODY,
  PLAN_CARD_ROW,
} from "./plan-card";
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

// The name of an input row and the button that binds it.
const INPUT_NAME =
  "nodrag nopan -ml-1 flex h-7 min-w-0 items-center rounded-md border border-transparent px-1 text-left text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default";

/**
 * The sequence input of a decision: when the flow reaches it, it decides.
 * @remarks
 * It is the one flow input of the decision, a row of the input column with
 * its dot on the left card edge; the header has no flow dot of its own.
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
    <div className={PLAN_CARD_ROW}>
      <PlanFlowHandle
        id={PLAN_PORT.flowIn}
        type="target"
        kind="flow"
        hasIssue={hasIssue}
        title={t("plans.decision.sequence")}
      />
      <button
        type="button"
        data-plan-in={decision.id}
        aria-label={t("plans.decision.sequenceLabel", { name: props.label })}
        title={t("plans.decision.sequence")}
        className={cn(
          INPUT_NAME,
          PLAN_NODE_TEXT.field,
          hasIssue && "text-destructive",
          planInTargetClass(graph, decision.id),
        )}
        disabled={!canEdit}
        onClick={() => graph.connect(decision.id)}
      >
        <span className="truncate">{t("plans.linkKind.flow")}</span>
      </button>
    </div>
  );
}

/**
 * The data input of a decision: its port, its name and what it reads in the
 * value field; the field's tooltip names the kind of value its mode takes.
 */
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
    <div className="relative grid h-8 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-1">
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
          INPUT_NAME,
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
      <DecisionBinding
        decision={decision}
        kind={t(isModel ? "plans.decision.content" : "plans.decision.boolean")}
      />
    </div>
  );
}

/** What the decision reads, in plain words: its source and its kind, or that nothing is connected. */
function DecisionBinding(props: {
  readonly decision: AgentPlanDecision;
  /** The kind of value the decision's mode takes, named in the tooltip. */
  readonly kind: string;
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
      title={`${props.kind} · ${text}`}
      className={cn(
        "flex h-6 max-w-[6.5rem] min-w-0 items-center rounded-md bg-muted px-2",
        PLAN_NODE_TEXT.field,
        source === null ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <span className="truncate">{text}</span>
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
          : t("plans.decision.instanceModel")}
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
 * The Decision node: a sequence input and one data input on the left, one
 * output per answer on the right, of which exactly one is activated each
 * time it decides.
 * @remarks
 * A boolean decision reads a boolean parameter or an agent's boolean and
 * calls no model; a model decision asks the chosen model one question about
 * a ticket or a text result. While a run is shown, the card names
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
      stateClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunMarker hasRun={props.hasRun} result={result} />}
      flowDots={{ hasIn: false, hasOut: false }}
      onEdit={edit}
    >
      <div
        data-plan-decision={decision.id}
        data-plan-decision-mode={isModel ? "model" : "boolean"}
        className={PLAN_CARD_BODY}
      >
        <PlanRunNotes result={result} />
        <PlanCardColumns
          inputs={
            <>
              <DecisionSequenceIn decision={decision} label={label} />
              <DecisionConditionIn decision={decision} label={label} />
            </>
          }
          outputs={
            <DecisionOutputs
              decision={decision}
              label={label}
              taken={result?.branch}
            />
          }
        />
        <DecisionModel decision={decision} />
      </div>
      <PlanDecisionFooter result={result} />
    </PlanCard>
  );
}

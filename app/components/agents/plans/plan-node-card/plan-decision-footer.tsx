import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { findPlanNodeAnywhere } from "./use-plan-decision-source";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** The name of the node a decision read, from the draft or else from the run. */
function useReadName(nodeId: string | undefined): string {
  const { t } = useTranslation();
  const { draft, sources, run } = usePlanFlowContext();
  if (nodeId === undefined) return "";
  const node = findPlanNodeAnywhere(draft, nodeId);
  if (node) return planNodeLabel(node, sources);
  return (
    run?.steps.find((step) => step.id === nodeId)?.name ??
    t("plans.run.unknownNode")
  );
}

/** What a boolean decision read in the shown run: the parameter or the agent's start and its value. */
function ConditionLine(props: {
  readonly result: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const condition = props.result.condition;
  const name = useReadName(condition?.sourceStepId);
  if (!condition) return null;
  const text =
    condition.sourceKind === "parameter"
      ? t("plans.decision.evaluatedParameter", {
          name,
          value: String(condition.value),
        })
      : t("plans.decision.evaluated", {
          name,
          number: condition.sourceActivation,
          value: t(
            condition.value ? "plans.run.passed" : "plans.run.notPassed",
          ),
        });
  return (
    <p
      data-plan-evaluated={String(condition.value)}
      className="text-foreground"
    >
      {text}
    </p>
  );
}

/** What the model of a decision answered in the shown run, and why. */
function VerdictLines(props: {
  readonly result: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const verdict = props.result.verdict;
  const name = useReadName(verdict?.sourceStepId);
  if (!verdict) return null;
  return (
    <div
      data-plan-verdict={String(verdict.decision)}
      className="text-foreground"
    >
      <p>
        {t("plans.decision.answered", {
          value: String(verdict.decision),
          name,
        })}
      </p>
      <p className="line-clamp-3 text-muted-foreground" title={verdict.reason}>
        {t("plans.decision.reason", { reason: verdict.reason })}
      </p>
    </div>
  );
}

/**
 * The footer of a decision: that only one output is activated, and what the shown run decided.
 *
 * @remarks
 * A failed decision names its cause through the run notes above; the footer
 * never shows a value it did not decide.
 */
export function PlanDecisionFooter(props: {
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { result } = props;
  return (
    <footer
      className={cn(
        "border-t border-plan-logic-edge/30 px-3 py-2 text-muted-foreground",
        PLAN_NODE_TEXT.meta,
      )}
    >
      <p>{t("plans.decision.footer")}</p>
      {result ? <ConditionLine result={result} /> : null}
      {result ? <VerdictLines result={result} /> : null}
    </footer>
  );
}

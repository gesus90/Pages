import { useTranslation } from "react-i18next";

import { planVerdictDetail } from "./plan-decision-verdict";
import { planStatusKey } from "./plan-status";

import type { TFunction } from "i18next";
import type {
  AgentPlanStepActivation,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";

/** The word of an output: true or false, the failure or timeout of a Jump, or the value a model named for a classification. */
function branchWord(
  t: TFunction,
  branch: AgentPlanBranch,
  start: Pick<AgentPlanStepActivation, "verdict">,
): string {
  if (branch === "true" || branch === "false")
    return t(`plans.decision.branch.${branch}`);
  if (branch === "error" || branch === "timeout")
    return t(`plans.jump.port.${branch}`);
  return typeof start.verdict?.decision === "string"
    ? start.verdict.decision
    : t("plans.decision.caseUnnamed");
}

/**
 * Whether a result belongs to a decision: it names the output it activated or the value it read.
 * @remarks
 * A calling Jump also names the output it took, its failure or timeout
 * output, but it is no decision.
 */
export function isPlanDecisionResult(step: AgentPlanStepResult): boolean {
  if (step.jump !== undefined) return false;
  return (
    step.branch !== undefined ||
    step.condition !== undefined ||
    step.verdict !== undefined
  );
}

/**
 * What a node that started more than once, or a decision, adds to the run
 * details: the output a decision activated, and one line per earlier start.
 *
 * @remarks
 * Every line names the number of the start and what it ended with in words;
 * the current start is the one the details above describe.
 */
export function PlanStatusHistory(props: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { step } = props;
  const history = step.history ?? [];
  if (history.length === 0 && step.branch === undefined) return null;
  return (
    <div data-plan-history="" className="mb-3 space-y-1 text-xs leading-4.5">
      {step.branch === undefined ? null : (
        <p className="font-medium wrap-anywhere">
          {t("plans.run.branchTaken", {
            branch: branchWord(t, step.branch, step),
          })}
        </p>
      )}
      {step.verdict ? (
        <p data-plan-verdict-reason="" className="wrap-anywhere">
          {[
            planVerdictDetail(t, step.verdict),
            step.verdict.isCorrected ? t("plans.decision.corrected") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {history.length > 0 ? (
        <section aria-label={t("plans.run.history")}>
          <h4 className="font-semibold">{t("plans.run.history")}</h4>
          <ol className="text-muted-foreground">
            {history.map((entry) => (
              <li key={entry.activation} className="wrap-anywhere">
                {[
                  t("plans.run.historyEntry", {
                    number: entry.activation,
                    status: t(planStatusKey(entry.status)),
                  }),
                  entry.passed === undefined
                    ? null
                    : t(
                        entry.passed
                          ? "plans.run.passed"
                          : "plans.run.notPassed",
                      ),
                  entry.branch === undefined
                    ? null
                    : t("plans.run.branchTaken", {
                        branch: branchWord(t, entry.branch, entry),
                      }),
                  entry.verdict === undefined
                    ? null
                    : planVerdictDetail(t, entry.verdict),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

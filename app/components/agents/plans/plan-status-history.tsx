import { useTranslation } from "react-i18next";

import { planStatusKey } from "./plan-status";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** Whether a result belongs to a decision: it names the output it activated or the value it read. */
export function isPlanDecisionResult(step: AgentPlanStepResult): boolean {
  return step.branch !== undefined || step.condition !== undefined;
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
            branch: t(`plans.decision.branch.${step.branch}`),
          })}
        </p>
      )}
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
                        branch: t(`plans.decision.branch.${entry.branch}`),
                      }),
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

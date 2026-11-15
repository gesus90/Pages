import { useTranslation } from "react-i18next";

import { RunErrorBadge, RunErrorHint } from "./run-error-badge";
import { RunStatusBadge } from "./run-status-badge";

import type { AgentPlanRunStepEntry } from "@/definition/AgentPlanOperations";

/** The steps of a run with their state and, for a failed one, class, code and what to do. */
export function RunStepsTab({
  steps,
}: {
  readonly steps: readonly AgentPlanRunStepEntry[];
}): React.ReactElement {
  const { t } = useTranslation();
  if (steps.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("runDiagnosis.steps.empty")}
      </p>
    );
  return (
    <ul className="space-y-1.5">
      {steps.map((step) => (
        <li
          key={step.stepId}
          className="space-y-1 rounded-lg border border-border bg-surface px-3 py-2"
        >
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {step.name}
            </span>
            <RunStatusBadge status={step.status} />
            {step.isInherited ? (
              <span className="text-xs text-muted-foreground">
                {t("plans.recovery.inherited")}
              </span>
            ) : null}
            {step.errorClass ? (
              <RunErrorBadge
                errorClass={step.errorClass}
                errorCode={step.errorCode}
              />
            ) : null}
          </p>
          {step.errorClass ? (
            <RunErrorHint errorClass={step.errorClass} />
          ) : null}
          {step.errorCode ? (
            <p className="font-mono text-xs text-muted-foreground">
              {step.errorCode}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

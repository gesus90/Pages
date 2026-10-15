import { useTranslation } from "react-i18next";

import { PlanStatusBadge } from "./plan-status";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

/** Keeps checkpoint and group errors visible when the compact sequence shows only agents. */
export function PlanRunDiagnostics({
  run,
  agents,
}: {
  readonly run: AgentPlanRun;
  readonly agents: readonly AgentPlanStepResult[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const agentIds = new Set(agents.map((step) => step.id));
  const issues = run.steps.filter(
    (step) =>
      !agentIds.has(step.id) &&
      (step.error !== null ||
        step.cancellation !== "none" ||
        step.status === "failed"),
  );
  if (issues.length === 0) return null;
  return (
    <section
      aria-label={t("plans.runDiagnostics")}
      className="space-y-2 rounded-lg border border-border p-3 text-sm"
    >
      <h3 className="font-medium">{t("plans.runDiagnostics")}</h3>
      {issues.map((step) => (
        <div key={step.id} className="space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            {t(`plans.nodeType.${step.name}`, { defaultValue: step.name })}
            <PlanStatusBadge status={step.status} isBlocked={step.isBlocked} />
          </p>
          {step.failedStepId ? (
            <p>
              {t("plans.groups.failedAgent", {
                name:
                  run.steps.find((entry) => entry.id === step.failedStepId)
                    ?.name ?? step.failedStepId,
              })}
            </p>
          ) : null}
          {step.error ? (
            <p role="alert" className="text-destructive">
              {t(`settings.agents.error.${step.error}`, {
                defaultValue: t(`assistant.error.${step.error}`),
              })}
            </p>
          ) : null}
          {step.cancellation !== "none" ? (
            <p className="text-muted-foreground">
              {t(`plans.cancellation.${step.cancellation}`)}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

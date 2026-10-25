import { useTranslation } from "react-i18next";

import { planStatusKey } from "./plan-status";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

interface StatusActivityProps {
  readonly step: AgentPlanStepResult;
}

/** Displays explicit public activity; contract items never imply an active task. */
export function PlanStatusActivity({
  step,
}: StatusActivityProps): React.ReactElement | null {
  if (
    step.remote?.liveHistoryVersion === 1 &&
    !step.session?.activity?.titles.length &&
    !step.isBlocked
  )
    return null;
  return <ReportedActivity step={step} />;
}

function ReportedActivity({ step }: StatusActivityProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const reportedAt = step.session?.activity?.reportedAt;
  const timestamp = reportedAt ? new Date(reportedAt) : null;
  const time =
    timestamp && Number.isFinite(timestamp.getTime())
      ? `${new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }).format(timestamp)} UTC`
      : t("plans.progress.notReported");
  const titles = step.session?.activity?.titles ?? [];
  const isRunning = step.status === "running";
  const heading = isRunning
    ? "plans.progress.activity"
    : "plans.progress.lastActivity";
  return (
    <section className="mt-4 border-t border-border/80 pt-3">
      <h4 className="border-l-4 border-primary pl-3 text-xs leading-4.5 font-medium text-muted-foreground">
        {t(heading)}
      </h4>
      {titles.length ? (
        <ul className="mt-2 space-y-2">
          {titles.map((content, index) => {
            const [title, ...description] = content.split("\n");
            return (
              <li key={`${index}:${title}`}>
                <p className="text-xs leading-4.5 font-semibold wrap-anywhere">
                  {title}
                </p>
                {description.length ? (
                  <p className="mt-1 text-xs leading-4.5 whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                    {description.join("\n")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-xs leading-4.5 text-muted-foreground">
          {t(
            isRunning
              ? "plans.progress.noActivity"
              : "plans.progress.noLiveActivity",
          )}
        </p>
      )}
      {titles.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("plans.progress.activitySource", { time })}
        </p>
      ) : null}
      {step.isBlocked && step.error ? (
        <p className="mt-2 text-xs leading-4.5 text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: t(planStatusKey(step.status, step.isBlocked)),
          })}
        </p>
      ) : null}
    </section>
  );
}

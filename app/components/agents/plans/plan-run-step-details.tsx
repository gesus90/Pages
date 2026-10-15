import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PlanRunInputs } from "./plan-run-inputs";
import { PlanRunProgress } from "./plan-run-progress";
import { PlanRunSession } from "./plan-run-session";
import { PlanStatusBadge } from "./plan-status";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

function useStepDuration(step: AgentPlanStepResult): string {
  const { t } = useTranslation();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (step.status !== "running") return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [step.status]);
  const start = step.session?.startedAt;
  const end = step.session?.endedAt ?? step.session?.turnEndedAt;
  const until = end ? Date.parse(end) : now;
  if (!start || until === null) return "—";
  const seconds = Math.max(0, (until - Date.parse(start)) / 1000);
  return Number.isFinite(seconds)
    ? t("plans.details.durationValue", { seconds: seconds.toFixed(1) })
    : "—";
}

function StepFacts({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const duration = useStepDuration(step);
  const requested = step.session?.requested;
  const rows = [
    [t("plans.details.agent"), step.name],
    [t("plans.session.duration"), duration],
    [t("plans.session.model"), requested?.model ?? "—"],
    [t("plans.session.directory"), requested?.directory ?? "—"],
  ];
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0 space-y-1">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="pages-selectable break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepHeading({
  run,
  step,
}: {
  readonly run: AgentPlanRun;
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const group = run.steps.find((entry) => entry.id === step.groupId);
  const index =
    run.steps
      .filter((entry) => entry.groupId === step.groupId)
      .findIndex((entry) => entry.id === step.id) + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        {group ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.groups.step", { name: group.name, index })}
          </p>
        ) : null}
        <h3 className="break-words font-semibold">{step.name}</h3>
      </div>
      <PlanStatusBadge status={step.status} isBlocked={step.isBlocked} />
    </div>
  );
}

/** Keeps the selected agent's operational facts, business progress and live events in separate sections. */
export function PlanRunStepDetails({
  run,
  step,
}: {
  readonly run: AgentPlanRun;
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const session = step.session;
  const reportedSummary = session?.acceptance?.summary.trim();
  let summary = step.output ?? t("plans.details.noSummary");
  if (reportedSummary) summary = reportedSummary;
  return (
    <section
      id="plan-step-details"
      aria-label={t("plans.details.title", { name: step.name })}
      className="min-w-0 space-y-5 rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <StepHeading run={run} step={step} />
      <StepFacts step={step} />
      {step.cancellation !== "none" ? (
        <p className="text-sm text-muted-foreground">
          {t(`plans.cancellation.${step.cancellation}`)}
        </p>
      ) : null}
      {step.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: t(`assistant.error.${step.error}`),
          })}
        </p>
      ) : null}
      <div className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-semibold">{t("plans.details.summary")}</h4>
        <p className="pages-selectable text-sm whitespace-pre-wrap break-words">
          {summary.length > 400 ? `${summary.slice(0, 400)}…` : summary}
        </p>
      </div>
      <div className="grid min-w-0 gap-5 border-t border-border pt-4 lg:grid-cols-2">
        <PlanRunProgress step={step} />
        <PlanRunInputs
          runId={run.id}
          stepId={step.id}
          isAvailable={Boolean(session)}
        />
      </div>
      <section
        className="space-y-2 border-t border-border pt-4"
        aria-label={t("plans.details.logs")}
      >
        <h4 className="text-sm font-semibold">{t("plans.details.logs")}</h4>
        <p className="text-xs text-muted-foreground">
          {t("plans.details.logsHint")}
        </p>
        <ol
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          className="pages-selectable max-h-52 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 font-mono text-xs break-words"
        >
          {session?.events.map((event, index) => (
            <li key={`${index}:${event}`}>{event}</li>
          ))}
        </ol>
        {!session?.events.length ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.details.noLogs")}
          </p>
        ) : null}
      </section>
      {step.output !== null ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            {t("plans.details.output")}
          </summary>
          <pre className="pages-selectable mt-2 max-h-80 overflow-auto font-sans whitespace-pre-wrap break-words">
            {step.output}
          </pre>
        </details>
      ) : null}
      {session ? (
        <details className="border-t border-border pt-4 text-sm">
          <summary className="cursor-pointer font-medium">
            {t("plans.details.technical")}
          </summary>
          <PlanRunSession
            runId={run.id}
            stepId={step.id}
            session={session}
            requiresAcceptance={Boolean(step.groupId)}
          />
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("plans.details.notStarted")}
        </p>
      )}
    </section>
  );
}

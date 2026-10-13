import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";

import { PlanRunSession } from "./plan-run-session";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { usePlanRun } from "./use-plan-run";

/** Results contain only final sanitized text, never snapshots, credentials or native diagnostics. */
export function PlanRunView(props: {
  readonly state: ReturnType<typeof usePlanRun>;
  readonly onStop: (id: string) => void;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { run } = props.state;
  const completed =
    run?.steps.filter(
      (step) =>
        step.status === "succeeded" ||
        step.status === "failed" ||
        step.status === "cancelled" ||
        step.isBlocked,
    ).length ?? 0;
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label={t("plans.runView")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t("plans.runView")}</h2>
        <Select
          ariaLabel={t("plans.history")}
          value={props.state.selectedId}
          onValueChange={props.state.select}
          options={props.state.runs.map((entry) => ({
            value: entry.id,
            label: `${entry.startedAt} · ${t(`plans.status.${entry.status}`)}`,
          }))}
        />
      </div>
      {props.state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.error.${props.state.error}`)}
        </p>
      ) : null}
      {run ? (
        <>
          <div className="flex items-center gap-3">
            <p role="status" className="text-sm">
              {t(`plans.status.${run.status}`)} · {completed}/{run.steps.length}
            </p>
            {run.status === "running" || run.status === "paused" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={props.isPending || run.stopRequested}
                onClick={() => props.onStop(run.id)}
              >
                {t(run.stopRequested ? "plans.stopRequested" : "plans.stop")}
              </Button>
            ) : null}
          </div>
          <progress
            className="h-2 w-full accent-primary"
            aria-label={t("plans.progress")}
            value={completed}
            max={run.steps.length}
          />
          <RunSteps runId={run.id} steps={run.steps} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("plans.noRuns")}</p>
      )}
    </section>
  );
}

function RunSteps({
  runId,
  steps,
}: {
  readonly runId: string;
  readonly steps: readonly AgentPlanStepResult[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.id} className="rounded-lg bg-surface p-3 text-sm">
          <p className="font-medium">
            {t(`plans.nodeType.${step.name}`, {
              defaultValue: step.name,
            })}{" "}
            <span className="font-normal">
              {t(
                step.isBlocked
                  ? "plans.blocked"
                  : `plans.status.${step.status}`,
              )}
            </span>
          </p>
          {step.cancellation !== "none" ? (
            <p className="text-xs text-muted-foreground">
              {t(`plans.cancellation.${step.cancellation}`)}
            </p>
          ) : null}
          {step.error ? (
            <p className="text-destructive">
              {t(`settings.agents.error.${step.error}`, {
                defaultValue: t(`assistant.error.${step.error}`),
              })}
            </p>
          ) : null}
          {step.output !== null ? (
            <pre className="pages-selectable mt-2 whitespace-pre-wrap break-words font-sans">
              {step.output}
            </pre>
          ) : null}
          {step.session ? (
            <PlanRunSession
              runId={runId}
              stepId={step.id}
              session={step.session}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

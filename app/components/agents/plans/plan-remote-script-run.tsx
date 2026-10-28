import { useTranslation } from "react-i18next";

import { PlanScriptStream } from "./plan-script-stream";

import type { TFunction } from "i18next";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

function details(
  step: AgentPlanStepResult,
  translate: TFunction,
): readonly [string, string | number | null][] {
  const { execution } = step;
  return [
    ["profile", execution?.interpreterProfileId ?? null],
    ["directory", execution?.workspace.path ?? null],
    ["attempt", execution?.attemptId ?? null],
    ...processDetails(step.remote, translate),
  ];
}

function processDetails(
  remote: AgentPlanStepResult["remote"],
  translate: TFunction,
): readonly [string, string | number | null][] {
  return [
    ["observedStart", remote?.startedAt ?? null],
    ["observedEnd", remote?.endedAt ?? null],
    ["exit", remote?.exitCode ?? null],
    ["signal", remote?.signal ?? null],
    [
      "closeout",
      remote ? translate(`plans.scripts.run.${remote.closeout}`) : null,
    ],
  ];
}

function hasPartialOutput(step: AgentPlanStepResult): boolean {
  return ["timeout", "cancelled", "output_limit", "lost", "storage"].includes(
    step.remote?.reason ?? "",
  );
}

/** Displays the recorded remote script attempt, including bounded separate streams. */
export function PlanRemoteScriptRun({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const remote = step.remote;
  const rows = details(step, t);
  return (
    <section className="min-w-0 space-y-3">
      <h4 className="font-medium">{t("plans.scripts.run.title")}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 wrap-anywhere">
        {rows.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">
              {t(`plans.scripts.run.${label}`)}
            </dt>
            <dd className="whitespace-pre-wrap">{text ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {step.error ? (
        <p role="alert" className="text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: step.error,
          })}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {t("plans.scripts.run.remoteTail")}
      </p>
      {hasPartialOutput(step) ? (
        <p className="text-muted-foreground">
          {t("plans.scripts.run.remotePartial")}
        </p>
      ) : null}
      <PlanScriptStream name="stdout" text={remote?.stdout ?? step.output} />
      <PlanScriptStream name="stderr" text={remote?.stderr ?? null} />
    </section>
  );
}

import { useTranslation } from "react-i18next";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** Process diagnostics within the ordinary run view, without suggesting an agent session. */
export function PlanScriptRun({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const script = step.script;
  if (!script) return null;
  const details: readonly [string, string | number | null][] = [
    ["profile", script.interpreterProfileId],
    ["directory", script.directory],
    ["identity", `${script.userId} · uid ${script.uid} · gid ${script.gid}`],
    ["attempt", script.attemptId],
    ["process", script.processId],
    ["started", script.startedAt],
    ["ended", script.endedAt],
    ["exit", script.exitCode],
    ["signal", script.signal],
    [
      "cause",
      script.failure
        ? t(`settings.agents.error.plan_script_${script.failure}`)
        : null,
    ],
    ["closeout", t(`plans.scripts.run.${script.closeout}`)],
  ];
  return (
    <section className="min-w-0 space-y-3">
      <h4 className="font-medium">{t("plans.scripts.run.title")}</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 wrap-anywhere">
        {details.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">
              {t(`plans.scripts.run.${label}`)}
            </dt>
            <dd className="whitespace-pre-wrap">{text ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">
        {t("plans.scripts.run.lifecycle")}
      </p>
      {step.error ? (
        <p role="alert" className="text-destructive">
          {t(`settings.agents.error.${step.error}`, {
            defaultValue: step.error,
          })}
        </p>
      ) : null}
      <ScriptStream name="stdout" text={script.stdout} />
      <ScriptStream name="stderr" text={script.stderr} />
    </section>
  );
}

function ScriptStream({
  name,
  text,
}: {
  readonly name: string;
  readonly text: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <h5 className="font-medium">{name}</h5>
      <pre
        tabIndex={0}
        aria-label={name}
        className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere"
      >
        {text === null || text === "" ? t("plans.scripts.run.empty") : text}
      </pre>
    </div>
  );
}

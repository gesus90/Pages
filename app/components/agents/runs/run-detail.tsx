import { EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Tabs } from "@/app/components/ui/tabs";
import { formatLocalTime } from "@/app/components/agents/plans/plan-agent-console/console-time";

import { RunErrorBadge, RunErrorHint } from "./run-error-badge";
import { RunLogsTab } from "./run-logs-tab";
import { RunStatusBadge } from "./run-status-badge";
import { RunStepsTab } from "./run-steps-tab";
import { RunTimelineTab } from "./run-timeline-tab";
import { useRunDiagnosisQuery } from "./use-run-diagnosis-query";

import type { RunDiagnosisAnswers } from "./run-diagnosis-model";

type RunTab = "steps" | "timeline" | "logs";

const TABS: readonly RunTab[] = ["steps", "timeline", "logs"];

function isRun(value: unknown): value is RunDiagnosisAnswers["run"] {
  return typeof value === "object" && value !== null && "run" in value;
}

function isTab(value: string): value is RunTab {
  return TABS.some((tab) => tab === value);
}

/**
 * One run with the tabs Steps, Timeline and Logs.
 *
 * @remarks
 * Whoever may see the plan reads the run, whoever started it. Fields left
 * out for lack of access to the content of the run are named, not guessed.
 */
export function RunDetail({
  runId,
}: {
  readonly runId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RunTab>("steps");
  const query = useRunDiagnosisQuery("run", { runId }, isRun);
  const readable = query.data;
  if (query.isFailed)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("runDiagnosis.loadFailed")}
      </p>
    );
  if (!readable)
    return (
      <p className="text-sm text-muted-foreground">
        {t("runDiagnosis.loading")}
      </p>
    );
  const { run } = readable;
  return (
    <section className="space-y-3" aria-labelledby="run-detail-title">
      <header className="space-y-1.5">
        <h2
          id="run-detail-title"
          className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground"
        >
          {run.planName}
          <RunStatusBadge status={run.status} />
          {run.errorClass ? (
            <RunErrorBadge
              errorClass={run.errorClass}
              errorCode={run.errorCode}
            />
          ) : null}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("runDiagnosis.runs.startedBy", {
            name: readable.startedBy.displayName,
            time: formatLocalTime(run.startedAt) ?? run.startedAt,
          })}
          {readable.isStarter ? ` · ${t("runDiagnosis.detail.ownRun")}` : ""}
        </p>
        {run.errorClass ? <RunErrorHint errorClass={run.errorClass} /> : null}
        {readable.hiddenFields.length > 0 ? (
          <p
            role="note"
            className="flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t("runDiagnosis.detail.hidden")}
          </p>
        ) : null}
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isTab(value)) setTab(value);
        }}
        ariaLabel={t("runDiagnosis.detail.tabs")}
        tabs={TABS.map((entry) => ({
          value: entry,
          label: t(`runDiagnosis.detail.tab.${entry}`),
        }))}
      >
        <div className="pt-3">
          {tab === "steps" ? <RunStepsTab steps={run.steps} /> : null}
          {tab === "timeline" ? <RunTimelineTab runId={run.runId} /> : null}
          {tab === "logs" ? <RunLogsTab runId={run.runId} /> : null}
        </div>
      </Tabs>
    </section>
  );
}

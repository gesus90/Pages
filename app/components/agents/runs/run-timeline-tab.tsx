import { useTranslation } from "react-i18next";

import {
  formatDuration,
  formatLocalTime,
} from "@/app/components/agents/plans/plan-agent-console/console-time";
import { cn } from "@/app/lib/cn";

import { useRunDiagnosisQuery } from "./use-run-diagnosis-query";

import type { AgentRunTimelineEntry } from "@/definition/AgentRunDiagnosis";
import type { RunDiagnosisAnswers } from "./run-diagnosis-model";

function isTimeline(value: unknown): value is RunDiagnosisAnswers["timeline"] {
  return typeof value === "object" && value !== null && "entries" in value;
}

const EVENT_TONES: Readonly<Record<AgentRunTimelineEntry["event"], string>> = {
  started: "bg-info",
  waiting: "bg-warning",
  retrying: "bg-warning",
  paused: "bg-warning",
  resumed: "bg-info",
  succeeded: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

/** The reason of an entry: an error code, a wait or a retry cause, kept readable without guessing. */
function reasonText(
  t: (key: string, options?: Record<string, unknown>) => string,
  reason: string | null,
): string | null {
  if (reason === null) return null;
  return t(
    `runDiagnosis.timeline.reason.${reason.split(";")[0]?.split(":")[0] ?? ""}`,
    {
      defaultValue: reason,
    },
  );
}

/** The attempts of a run in time order, with waits, retries and the steps that show no progress. */
export function RunTimelineTab({
  runId,
}: {
  readonly runId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const query = useRunDiagnosisQuery("timeline", { runId }, isTimeline);
  const timeline = query.data;
  if (query.isFailed)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("runDiagnosis.loadFailed")}
      </p>
    );
  if (!timeline)
    return (
      <p className="text-sm text-muted-foreground">
        {t("runDiagnosis.loading")}
      </p>
    );
  return (
    <div className="space-y-3">
      {timeline.stalled.length > 0 ? (
        <ul
          className="space-y-1"
          aria-label={t("runDiagnosis.timeline.stalledTitle")}
        >
          {timeline.stalled.map((step) => (
            <li
              key={`${step.stepId}:${step.attemptId}`}
              role="status"
              className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning"
            >
              {t("runDiagnosis.timeline.stalled", {
                step: step.stepId,
                duration: formatDuration(step.stalledForMs),
                since: formatLocalTime(step.lastEventAt) ?? step.lastEventAt,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {timeline.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.timeline.empty")}
        </p>
      ) : null}
      <ol className="space-y-1.5">
        {timeline.entries.map((entry, index) => (
          <li
            key={`${entry.stepId}:${entry.attemptId}:${entry.event}:${String(index)}`}
            className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                EVENT_TONES[entry.event],
              )}
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm text-foreground">
                <span className="font-medium">{entry.stepLabel}</span>
                {entry.iteration !== null
                  ? ` (${t("runDiagnosis.timeline.iteration", { iteration: entry.iteration })})`
                  : ""}
                {" · "}
                {t(`runDiagnosis.timeline.event.${entry.event}`)}
                {entry.durationMs !== null
                  ? ` · ${formatDuration(entry.durationMs)}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatLocalTime(entry.at) ?? entry.at}
                {" · "}
                {t("runDiagnosis.timeline.attempt", {
                  id: entry.attemptId.slice(0, 8),
                })}
                {reasonText(t, entry.reason)
                  ? ` · ${reasonText(t, entry.reason) ?? ""}`
                  : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

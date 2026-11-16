import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { formatLocalTime } from "../plan-agent-console/console-time";
import { PlanRunLogMark } from "./plan-run-log-mark";
import { formatLogTime, planRunLogEntries } from "./plan-run-log-model";
import { usePlanRunLog } from "./use-plan-run-log";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanRunLogEntry } from "./plan-run-log-model";

/**
 * One message: mark and time on its first line, the text wrapping beside them.
 * @remarks
 * Further lines start under the text, never under the mark or the time; the
 * text keeps the normal text colour whatever its state.
 */
function PlanRunLogLine({
  entry,
}: {
  readonly entry: PlanRunLogEntry;
}): React.ReactElement {
  return (
    <li
      data-plan-log-entry={entry.tone}
      className="grid grid-cols-[1rem_auto_minmax(0,1fr)] items-start gap-x-2.5 py-1 text-xs leading-5"
    >
      <span className="flex h-5 items-center">
        <PlanRunLogMark tone={entry.tone} />
      </span>
      <time
        dateTime={entry.at}
        title={formatLocalTime(entry.at) ?? entry.at}
        className="font-mono text-muted-foreground tabular-nums"
      >
        {formatLogTime(entry.at)}
      </time>
      <span className="whitespace-pre-wrap text-foreground wrap-anywhere">
        {entry.message}
        {entry.detail ? `\n${entry.detail}` : ""}
      </span>
    </li>
  );
}

/** The short line in place of entries: no run, still reading, failed or empty. */
function PlanRunLogNote({
  text,
  isAlert = false,
}: {
  readonly text: string;
  readonly isAlert?: boolean;
}): React.ReactElement {
  return (
    <p
      role={isAlert ? "alert" : undefined}
      className={
        isAlert
          ? "px-3 py-2 text-xs text-destructive"
          : "px-3 py-2 text-xs text-muted-foreground"
      }
    >
      {text}
    </p>
  );
}

/** What the log shows of the run: its entries, or the short line that replaces them. */
function PlanRunLogBody({
  run,
}: {
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const log = usePlanRunLog(run);
  const listRef = useRef<HTMLOListElement>(null);
  const entries = log.timeline ? planRunLogEntries(log.timeline, t) : [];
  const newest = entries.at(-1)?.key ?? null;
  // The newest message is the one that matters while a run moves on.
  useEffect(() => {
    const list = listRef.current?.parentElement;
    if (list && newest !== null) list.scrollTop = list.scrollHeight;
  }, [newest]);
  if (!run) return <PlanRunLogNote text={t("plans.panel.runLog.noRun")} />;
  if (!log.timeline && log.isFailed)
    return <PlanRunLogNote text={t("plans.panel.runLog.failed")} isAlert />;
  if (!log.timeline)
    return <PlanRunLogNote text={t("plans.panel.runLog.loading")} />;
  if (entries.length === 0)
    return <PlanRunLogNote text={t("plans.panel.runLog.empty")} />;
  return (
    <ol ref={listRef} className="px-3 py-1">
      {entries.map((entry) => (
        <PlanRunLogLine key={entry.key} entry={entry} />
      ))}
    </ol>
  );
}

/**
 * „Laufprotokoll“: the messages of the run the canvas shows, in a box of its own height.
 * @remarks
 * The box shows about four short messages and scrolls by itself, so the
 * panel never grows with the history and the graph stays in view. It holds
 * only the shown run: a run that has not started, or another plan, never
 * shows messages of an earlier run.
 */
export function PlanRunLog({
  run,
}: {
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section aria-label={t("plans.panel.runLog.label")} className="space-y-1.5">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        {t("plans.panel.runLog.title")}
        <span className="text-xs font-normal text-muted-foreground">
          {t("plans.panel.runLog.current")}
        </span>
      </h3>
      <div
        data-plan-run-log=""
        // A scrolling box that the keyboard can reach as well.
        tabIndex={0}
        className="max-h-32 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background focus-visible:outline-2 focus-visible:outline-ring"
      >
        <PlanRunLogBody key={run?.id ?? "none"} run={run} />
      </div>
    </section>
  );
}

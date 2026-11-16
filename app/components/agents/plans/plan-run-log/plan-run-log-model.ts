import { formatDuration } from "../plan-agent-console/console-time";

import type { TFunction } from "i18next";
import type {
  AgentRunTimeline,
  AgentRunTimelineEntry,
  AgentRunTimelineEvent,
} from "@/definition/AgentRunDiagnosis";

const LOG_TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

/** The state a log entry claims; `info` claims neither success nor failure. */
export type PlanRunLogTone = "success" | "warning" | "error" | "info";

/** One message of the run log: when it happened, what it claims and its text. */
export interface PlanRunLogEntry {
  readonly key: string;
  readonly at: string;
  readonly tone: PlanRunLogTone;
  readonly message: string;
  /** A further line, such as the cause of a wait or a failure. */
  readonly detail: string | null;
}

/**
 * The state of each recorded event kind.
 * @remarks
 * Only a recorded success or failure is shown as one. A wait and a retry are
 * warnings, a cancelled step did not finish; a start, a pause by the person
 * and a resumption only inform.
 */
const EVENT_TONES: Readonly<Record<AgentRunTimelineEvent, PlanRunLogTone>> = {
  started: "info",
  waiting: "warning",
  retrying: "warning",
  paused: "info",
  resumed: "info",
  succeeded: "success",
  failed: "error",
  cancelled: "warning",
};

/** Whether an answer of the run diagnosis is the timeline of the given run. */
export function isPlanRunTimeline(
  value: unknown,
  runId: string,
): value is AgentRunTimeline {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    value.runId === runId &&
    "entries" in value &&
    Array.isArray(value.entries) &&
    "stalled" in value &&
    Array.isArray(value.stalled)
  );
}

/** The cause of an entry: a known code in words, anything else as recorded. */
function reasonText(
  translate: TFunction,
  reason: string | null,
): string | null {
  if (reason === null || reason === "") return null;
  const code = reason.split(";")[0]?.split(":")[0] ?? "";
  return translate(`runDiagnosis.timeline.reason.${code}`, {
    defaultValue: reason,
  });
}

function stepName(entry: AgentRunTimelineEntry, translate: TFunction): string {
  const label = entry.stepLabel || entry.stepId;
  return entry.iteration === null
    ? label
    : `${label} (${translate("runDiagnosis.timeline.iteration", { iteration: entry.iteration })})`;
}

function eventEntry(
  entry: AgentRunTimelineEntry,
  index: number,
  translate: TFunction,
): PlanRunLogEntry {
  const duration =
    entry.durationMs === null ? "" : ` · ${formatDuration(entry.durationMs)}`;
  return {
    key: `${entry.stepId}:${entry.attemptId}:${entry.event}:${String(index)}`,
    at: entry.at,
    tone: EVENT_TONES[entry.event],
    message: `${stepName(entry, translate)} · ${translate(`runDiagnosis.timeline.event.${entry.event}`)}${duration}`,
    detail: reasonText(translate, entry.reason),
  };
}

/**
 * The messages of one run in time order, oldest first.
 * @param timeline - The recorded timeline of exactly the run the log shows.
 * @param translate - Translates the event kinds and causes.
 * @remarks
 * Each entry keeps the state of its recorded event kind; a step that reports
 * no progress for too long adds a warning at its last event.
 */
export function planRunLogEntries(
  timeline: AgentRunTimeline,
  translate: TFunction,
): readonly PlanRunLogEntry[] {
  const events = timeline.entries.map((entry, index) =>
    eventEntry(entry, index, translate),
  );
  const stalled = timeline.stalled.map((step): PlanRunLogEntry => {
    const named = timeline.entries.find(
      (entry) => entry.stepId === step.stepId,
    );
    return {
      key: `stalled:${step.stepId}:${step.attemptId}`,
      at: step.lastEventAt,
      tone: "warning",
      message: translate("runDiagnosis.timeline.stalled", {
        step: named?.stepLabel ?? step.stepId,
        duration: formatDuration(step.stalledForMs),
        since: formatLogTime(step.lastEventAt),
      }),
      detail: null,
    };
  });
  return [...events, ...stalled].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  );
}

/**
 * The time of a log entry in the reader's time zone, such as `15:07:18`.
 * @param value - An ISO time as the server stores it.
 * @returns The time, or the stored value when it cannot be read.
 */
export function formatLogTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : LOG_TIME.format(time);
}

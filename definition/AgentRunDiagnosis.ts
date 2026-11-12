/**
 * The diagnosis of agent plan runs for the whole team (PAGE-307).
 *
 * @remarks
 * These shapes are the interface contract shared with the Pages MCP client
 * (PMCP-13): the field names, the error classes and the limits are fixed. A
 * new class needs a change of PAGE-307 and PMCP-13.
 */

/** The fixed classes every failure of a step or run falls into. */
export const AGENT_RUN_ERROR_CLASSES = [
  "model",
  "tool_missing",
  "timeout",
  "git",
  "workspace_busy",
  "permission",
  "plan_invalid",
  "process_crash",
  "runner_unavailable",
  "acceptance_failed",
  "unknown",
] as const;

/** One of {@link AGENT_RUN_ERROR_CLASSES}. */
export type AgentRunErrorClass = (typeof AGENT_RUN_ERROR_CLASSES)[number];

/** Narrows an untrusted value to a class. */
export function isAgentRunErrorClass(
  candidate: unknown,
): candidate is AgentRunErrorClass {
  return AGENT_RUN_ERROR_CLASSES.some((entry) => entry === candidate);
}

/** The classified failure of a run or of one of its steps. */
export interface AgentRunErrorFields {
  readonly errorClass: AgentRunErrorClass;
  /** Stable code; the code a step stores, or `unknown_error` for text without a code. */
  readonly errorCode: string;
  /** What can be done about it. */
  readonly errorHint: string;
}

/** The classification with the short message, for the interface. */
export interface AgentRunErrorClassification extends AgentRunErrorFields {
  readonly errorMessage: string;
}

/** The person who started a run. */
export interface AgentRunStarter {
  readonly id: string;
  readonly displayName: string;
}

/** The status values a run list can be narrowed to. */
export const AGENT_RUN_LIST_STATUSES = [
  "running",
  "pausing",
  "paused",
  "stopping",
  "succeeded",
  "failed",
  "cancelled",
  "work_done_closeout_open",
] as const;

/** Limits of the diagnosis reads, the same on every transport. */
export const AGENT_RUN_DIAGNOSIS_LIMITS = {
  runsDefault: 20,
  runsMaximum: 100,
  failureGroupsDefault: 20,
  failureGroupsMaximum: 100,
  logsDefault: 200,
  logsMaximum: 500,
  logMessageBytes: 8192,
  exampleRuns: 5,
} as const;

/** How the failures of the overview are grouped. */
export type AgentRunFailureGrouping = "errorClass" | "plan" | "step";

/** One row of the run list across plans. */
export interface AgentRunListEntry {
  readonly runId: string;
  readonly planId: string;
  readonly planName: string;
  readonly projectId: string;
  readonly status: (typeof AGENT_RUN_LIST_STATUSES)[number];
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly startedBy: AgentRunStarter;
  readonly failedStepId: string | null;
  readonly errorClass: AgentRunErrorClass | null;
  readonly errorCode: string | null;
}

/** `list_runs`: one page of the runs of every visible plan. */
export interface AgentRunList {
  readonly runs: readonly AgentRunListEntry[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly hiddenFields: readonly string[];
}

/** One group of the failure overview. */
export interface AgentRunFailureGroup {
  readonly errorClass: AgentRunErrorClass | null;
  readonly planId: string | null;
  readonly planName: string | null;
  readonly stepId: string | null;
  readonly stepLabel: string | null;
  readonly count: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly exampleRunIds: readonly string[];
  readonly hint: string | null;
}

/** `summarize_run_failures`: failed steps grouped by class, plan or step. */
export interface AgentRunFailureSummary {
  readonly groups: readonly AgentRunFailureGroup[];
  readonly totalFailedSteps: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly hiddenFields: readonly string[];
}

/** What happened to an attempt of a step. */
export type AgentRunTimelineEvent =
  | "started"
  | "waiting"
  | "retrying"
  | "paused"
  | "resumed"
  | "succeeded"
  | "failed"
  | "cancelled";

/** One entry of the timeline of a run. */
export interface AgentRunTimelineEntry {
  readonly stepId: string;
  readonly stepLabel: string;
  readonly loopId: string | null;
  readonly iteration: number | null;
  readonly attemptId: string;
  readonly event: AgentRunTimelineEvent;
  readonly at: string;
  readonly durationMs: number | null;
  readonly reason: string | null;
}

/** A step of a running run that reported nothing new for too long. */
export interface AgentRunStalledStep {
  readonly stepId: string;
  readonly attemptId: string;
  readonly lastEventAt: string;
  readonly stalledForMs: number;
}

/** `read_plan_run_timeline`: the attempts of a run in time order and its stalled steps. */
export interface AgentRunTimeline {
  readonly runId: string;
  readonly planId: string;
  readonly status: AgentRunListEntry["status"];
  readonly entries: readonly AgentRunTimelineEntry[];
  readonly stalled: readonly AgentRunStalledStep[];
  readonly startedBy: AgentRunStarter;
  readonly hiddenFields: readonly string[];
}

/** The levels of a run log, from the least to the most severe. */
export const AGENT_RUN_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

/** One of {@link AGENT_RUN_LOG_LEVELS}. */
export type AgentRunLogLevel = (typeof AGENT_RUN_LOG_LEVELS)[number];

/** Where a log line comes from. */
export const AGENT_RUN_LOG_SOURCES = ["server", "runner", "cli"] as const;

/** One of {@link AGENT_RUN_LOG_SOURCES}. */
export type AgentRunLogSource = (typeof AGENT_RUN_LOG_SOURCES)[number];

/** One line of the log of a run. */
export interface AgentRunLogEntry {
  readonly at: string;
  readonly level: AgentRunLogLevel;
  readonly source: AgentRunLogSource;
  readonly stepId: string | null;
  readonly attemptId: string | null;
  /** At most 8 KiB; absent when the reader may not see the content of the line. */
  readonly message?: string;
  /** Whether credentials were removed or the text was shortened. */
  readonly isFiltered: boolean;
}

/** `read_plan_run_logs`: one page of the log of a run or step. */
export interface AgentRunLogPage {
  readonly entries: readonly AgentRunLogEntry[];
  readonly nextCursor: string | null;
  readonly isTruncated: boolean;
  readonly hiddenFields: readonly string[];
}

/** The settings of the diagnosis under Settings → Agents. */
export interface AgentRunDiagnosisSettings {
  /** How many days the logs and failure records of runs are kept. */
  readonly logRetentionDays: number;
  /** After how many minutes without a new event a running step counts as stalled. */
  readonly stallMinutes: number;
  readonly revision: number;
}

export const AGENT_RUN_LOG_RETENTION_DEFAULT = 30;
export const AGENT_RUN_LOG_RETENTION_RANGE = { minimum: 1, maximum: 365 };
export const AGENT_RUN_STALL_MINUTES_DEFAULT = 15;
export const AGENT_RUN_STALL_MINUTES_RANGE = { minimum: 1, maximum: 1440 };

/**
 * Who started a run and which of its fields the reader may not see (PAGE-307).
 *
 * @remarks
 * Every read of a single run carries it. `hiddenFields` names what was left
 * out because the reader may not see the tickets, pages or workspaces the run
 * used; it is empty when nothing is hidden.
 */
export interface AgentPlanRunAttribution {
  readonly startedBy: AgentRunStarter;
  readonly hiddenFields: readonly string[];
}

/** A read result of one run together with its attribution. */
export type Attributed<Result> = Result & AgentPlanRunAttribution;

/** The results of the reads across runs. */
export type AgentRunDiagnosisReadResult =
  AgentRunList | AgentRunFailureSummary | AgentRunTimeline | AgentRunLogPage;

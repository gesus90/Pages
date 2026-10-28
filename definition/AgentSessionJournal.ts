import type {
  AgentPlanRunner,
  AgentPlanSessionRecord,
} from "./AgentPlanSession.js";

import type {
  AgentSessionKey,
  AgentSessionState,
} from "./AgentSessionEvents.js";

export type {
  AgentSessionKey,
  AgentSessionState,
  AgentSessionEventKind,
  AgentSessionEvent,
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
} from "./AgentSessionEvents.js";

/** The current occupancy of the context window, as the adapter reported it. */
export interface AgentSessionContextUsage {
  /** Tokens currently in context; `null` when the adapter reported none that holds. */
  readonly contextUsed: number | null;
  /** The context window; `null` when the adapter reported none. */
  readonly contextLimit: number | null;
  /** Share of the window in percent; `null` without both values. */
  readonly percent: number | null;
  readonly source: "acp_usage_update" | null;
  readonly reportedAt: string | null;
}

/**
 * Token counts of one turn or a sum of turns.
 *
 * @remarks
 * A count the adapter did not report is `null`, never 0. Counts are never
 * derived from text lengths or from the context occupancy.
 */
export interface AgentSessionTokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly totalTokens: number | null;
  /** Whether `inputTokens` contains the cache reads; `null` where the adapter's counting is not verified. */
  readonly inputIncludesCache: boolean | null;
  /** The adapter counted only part of the work, or a turn of the sum reported nothing. */
  readonly isPartial: boolean;
}

/** The token usage of one turn, written once per turn. */
export interface AgentSessionTurnUsage extends AgentSessionTokenUsage {
  readonly attemptId: string;
  readonly turn: number;
  readonly provider: Exclude<AgentPlanRunner, "api">;
  /** The confirmed model of the turn; `null` when none was confirmed. */
  readonly model: string | null;
  readonly reportedAt: string;
}

/** Usage sums of one provider's counting; different countings are never added up. */
export interface AgentSessionUsageTotal extends AgentSessionTokenUsage {
  readonly provider: Exclude<AgentPlanRunner, "api">;
  readonly turns: number;
  /** Every confirmed model the sum contains, in order of first use. */
  readonly models: readonly string[];
}

/** A configuration value Pages asked for or the adapter confirmed, with its origin. */
export interface AgentSessionReportedValue {
  /** `null` when nobody reported a value; an unknown model is never shown as confirmed. */
  readonly value: string | null;
  readonly source:
    | "plan"
    | "acp_config_option"
    | "acp_usage_report"
    | "adapter_selector"
    | null;
  readonly reportedAt: string | null;
}

/** Requested and confirmed model and reasoning of a session, kept apart. */
export interface AgentSessionModelReport {
  readonly requestedModel: AgentSessionReportedValue;
  readonly requestedReasoning: AgentSessionReportedValue;
  readonly confirmedModel: AgentSessionReportedValue;
  readonly confirmedReasoning: AgentSessionReportedValue;
}

/** The Git state of the assigned workspace, read by Pages from the repository files. */
export type AgentSessionGitState =
  | { readonly state: "branch"; readonly branch: string }
  | { readonly state: "detached"; readonly commit: string }
  | { readonly state: "no_repository" }
  | { readonly state: "unreadable" };

/** The workspace a session works in, as Pages assigned and checked it. */
export interface AgentSessionWorkspace {
  readonly directory: string;
  readonly git: AgentSessionGitState;
  readonly checkedAt: string;
}

/**
 * How the next instruction reaches the agent.
 *
 * @remarks
 * `live` continues the open native session. `load` and `resume` use a
 * capability the adapter confirmed in `initialize`. `reconstructed` starts a
 * new native session with a bounded summary of the history and says so.
 * `unavailable` names why nothing can continue.
 */
export type AgentSessionContinuationMode =
  "live" | "load" | "resume" | "reconstructed" | "unavailable";

/** The way the next instruction would continue the session, and why. */
export interface AgentSessionContinuation {
  readonly mode: AgentSessionContinuationMode;
  /** A stable reason code for `unavailable` and `reconstructed`; `null` otherwise. */
  readonly reason: string | null;
  /** Whether a plan checkpoint exists, which is recovery of the plan, not of the native session. */
  readonly hasPlanCheckpoint: boolean;
}

/** What a queued or delivered user instruction is. */
export type AgentSessionMessageKind = "instruction" | "repair";

/**
 * The delivery of one user instruction.
 *
 * @remarks
 * `delivering` is written before the native write; a delivery that the
 * server lost in this state becomes `uncertain` and is never retried
 * automatically.
 */
export type AgentSessionMessageStatus =
  "queued" | "delivering" | "delivered" | "failed" | "cancelled" | "uncertain";

/** One additional or repair instruction, kept apart from the frozen plan assignment. */
export interface AgentSessionMessage {
  readonly id: string;
  readonly attemptId: string;
  readonly userId: string;
  readonly kind: AgentSessionMessageKind;
  readonly text: string;
  readonly status: AgentSessionMessageStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The operations the reader may call right now. */
export interface AgentSessionActions {
  readonly canSend: boolean;
  readonly canCancelTurn: boolean;
  readonly canCancelRun: boolean;
  readonly canRecover: boolean;
}

/** The read API of one PageAgentCLI session. */
export interface AgentSessionView {
  readonly key: AgentSessionKey;
  readonly provider: AgentPlanRunner;
  readonly state: AgentSessionState;
  /** The group of the node; members share the process, never the attempt. */
  readonly groupId: string | null;
  readonly workspace: AgentSessionWorkspace | null;
  readonly model: AgentSessionModelReport;
  readonly context: AgentSessionContextUsage;
  readonly turns: readonly AgentSessionTurnUsage[];
  /** Sums of this attempt, one per provider counting. */
  readonly totals: readonly AgentSessionUsageTotal[];
  /** Sums of every attempt of the run, one per provider counting. */
  readonly runTotals: readonly AgentSessionUsageTotal[];
  readonly continuation: AgentSessionContinuation;
  readonly messages: readonly AgentSessionMessage[];
  readonly actions: AgentSessionActions;
}

/**
 * The attempt ID of a node's session record.
 *
 * @remarks
 * Records from before PAGE-85 have none. Instance and node identify their
 * only attempt: members of an ACP group share the instance, never the node.
 */
export function sessionAttemptId(
  record: Pick<AgentPlanSessionRecord, "attemptId" | "instanceId">,
  stepId: string,
): string {
  return record.attemptId ?? `${record.instanceId}:${stepId}`;
}

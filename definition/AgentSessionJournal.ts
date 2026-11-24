import type {
  CodexAccounting,
  CodexUsageSource,
  CodexRunUsage,
} from "./CodexPlanUsage";
import type {
  ClaudeAccounting,
  ClaudeUsageObservation,
  ClaudeUsageSummary,
} from "./ClaudeUsage";
import type {
  AgentPlanRunner,
  AgentPlanSessionRecord,
} from "./AgentPlanSession.js";
import type {
  AgentSessionKey,
  AgentSessionState,
} from "./AgentSessionEvents.js";
import type { AntigravityUsageView } from "./AgentSessionPricing";
import type { AgentSessionRunBranch } from "./AgentPlanRunBranch";
import type {
  AgentModelIdentity,
  AgentReasoningIdentity,
} from "./AgentModelIdentity";

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
  /**
   * The context window; `null` when neither the adapter nor the model's
   * catalog entry states one.
   * @remarks
   * The adapter's report wins. The session view fills a missing window from
   * the catalog of the attempt's model, so a fresh attempt shows its window
   * before the first report.
   */
  readonly contextLimit: number | null;
  /** Share of the window in percent; `null` without both values. */
  readonly percent: number | null;
  /**
   * `acp_usage_update` from the ACP adapter; from the Claude CLI of a runner
   * `cli_assistant_usage`, the latest top-level answer, or
   * `cli_compact_boundary`, the count a compaction kept; from the Codex CLI
   * of a runner `codex_token_count`, the latest `token_count` of its rollout.
   */
  readonly source:
    | "acp_usage_update"
    | "cli_assistant_usage"
    | "cli_compact_boundary"
    | "codex_token_count"
    | null;
  readonly reportedAt: string | null;
  /** The cumulative cost of the session where the adapter reports one; absent or `null` when unknown. */
  readonly cost?: AgentSessionCost | null;
}

/** A cost as an adapter reports it with `usage_update`. */
export interface AgentSessionCost {
  readonly amount: number;
  /** ISO 4217 code, such as `USD`. */
  readonly currency: string;
}

/**
 * Token counts of one turn or a sum of turns.
 * @remarks
 * A count the adapter did not report is `null`, never 0. Counts are never
 * derived from text lengths or from the context occupancy.
 */
export interface AgentSessionTokenUsage {
  readonly reasoningTokens?: number | null;
  readonly accounting?: CodexAccounting;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly totalTokens: number | null;
  /** Whether `inputTokens` contains the cache reads; `null` where the adapter's counting is not verified. */
  readonly inputIncludesCache: boolean | null;
  /** The adapter counted only part of the work, or a turn of the sum reported nothing. */
  readonly isPartial: boolean;
  /** USD charge calculated from the saved public price stand. */
  readonly costAmount?: number | null;
  readonly costState?: "known" | "free" | "unknown";
  readonly pricedAt?: string | null;
  readonly priceSnapshot?: string | null;
}

/** The token usage of one turn, written once per turn. */
export interface AgentSessionTurnUsage extends AgentSessionTokenUsage {
  readonly stepId?: string;
  /** Native receipt retained privately until projection; never returned with public usage. */
  readonly codex?: CodexUsageSource;
  /** Private pending observation, removed by the accounting service before SQL persistence. */
  readonly claudeObservation?: ClaudeUsageObservation;
  readonly claudeAccounting?: ClaudeAccounting;
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

/** Native OpenCode message totals for a step or an entire run. */
export interface OpenCodeUsageTotal {
  readonly messages: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly costUsd: number | null;
  readonly costState: "free" | "known" | "unknown";
  readonly isIncomplete: boolean;
  readonly priceAsOf: readonly string[];
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
    | "cli_stream_event"
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
  readonly codexRunUsage?: CodexRunUsage;
  readonly key: AgentSessionKey;
  readonly provider: AgentPlanRunner;
  readonly state: AgentSessionState;
  /** The group of the node; members share the process, never the attempt. */
  readonly groupId: string | null;
  readonly workspace: AgentSessionWorkspace | null;
  /** The prepared branch and the Git state recorded for the selected attempt. */
  readonly runBranch?: AgentSessionRunBranch | null;
  readonly model: AgentSessionModelReport;
  /**
   * The model as catalog identity for the shared badges; present only for
   * the providers with model badges: Claude Code, Codex, Antigravity,
   * OpenCode and OpenRouter.
   */
  readonly modelIdentity?: AgentModelIdentity | null;
  /**
   * The reasoning level for the shared badge; present only for the same
   * providers as {@link AgentSessionView.modelIdentity}.
   */
  readonly reasoning?: AgentReasoningIdentity;
  readonly context: AgentSessionContextUsage;
  readonly turns: readonly AgentSessionTurnUsage[];
  /** Sums of this attempt, one per provider counting. */
  readonly totals: readonly AgentSessionUsageTotal[];
  /** Sums of every attempt of the run, one per provider counting. */
  readonly runTotals: readonly AgentSessionUsageTotal[];
  readonly claudeUsage?: ClaudeUsageSummary;
  /** Sums of every attempt of this node in the run, without counting a turn twice. */
  readonly nodeTotals?: readonly AgentSessionUsageTotal[];
  /** Native message totals, present only for OpenCode sessions. */
  readonly openCode?: {
    readonly step: OpenCodeUsageTotal;
    readonly run: OpenCodeUsageTotal;
  };
  /** Captured Antigravity usage, independent of the subscription invoice. */
  readonly antigravity?: AntigravityUsageView;
  /** OpenRouter messages in every iteration of this run. */
  readonly openRouterRunTotal?: AgentSessionUsageTotal | null;
  /** A run step exists without native usage, including an active step before its first report. */
  readonly isOpenRouterRunIncomplete?: boolean;
  readonly continuation: AgentSessionContinuation;
  readonly messages: readonly AgentSessionMessage[];
  readonly actions: AgentSessionActions;
}

/**
 * The attempt ID of a node's session record.
 * @remarks
 * Older records have none. Instance and node identify their
 * only attempt: members of an ACP group share the instance, never the node.
 */
export function sessionAttemptId(
  record: Pick<AgentPlanSessionRecord, "attemptId" | "instanceId">,
  stepId: string,
): string {
  return record.attemptId ?? `${record.instanceId}:${stepId}`;
}

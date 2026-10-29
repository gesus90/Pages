import {
  readBooleanColumn,
  readCountColumn,
  readNullableBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";
import type { AgentSessionAttemptRecord } from "@/backend/service/agents/sessions/AgentSessionStore";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type {
  AgentSessionContextUsage,
  AgentSessionEvent,
  AgentSessionEventKind,
  AgentSessionGitState,
  AgentSessionMessage,
  AgentSessionMessageStatus,
  AgentSessionReportedValue,
  AgentSessionState,
  AgentSessionTurnUsage,
} from "@/definition/AgentSessionJournal";

type Row = readonly DatabaseValue[];

const PROVIDERS: readonly AcpProviderId[] = [
  "codex_cli",
  "claude_code",
  "opencode",
  "antigravity",
];
const STATES: readonly AgentSessionState[] = [
  "starting",
  "running",
  "waiting_for_input",
  "idle",
  "waiting_for_capacity",
  "recovering",
  "ended",
  "failed",
  "cancelled",
];
const EVENT_KINDS: readonly AgentSessionEventKind[] = [
  "user_instruction",
  "repair_instruction",
  "agent_message",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "plan",
  "status",
  "error",
  "recovery",
  "usage",
];
const MESSAGE_STATUSES: readonly AgentSessionMessageStatus[] = [
  "queued",
  "delivering",
  "delivered",
  "failed",
  "cancelled",
  "uncertain",
];
const VALUE_SOURCES = [
  "plan",
  "acp_config_option",
  "acp_usage_report",
  "adapter_selector",
] as const;

/** The columns of an attempt, in the order {@link readAttemptRow} reads them. */
export const ATTEMPT_COLUMNS = `
    agent_session_attempts.attempt_id,
    agent_session_attempts.plan_id,
    agent_session_attempts.run_id,
    agent_session_attempts.step_id,
    agent_session_attempts.user_id,
    agent_session_attempts.provider,
    agent_session_attempts.instance_id,
    agent_session_attempts.group_id,
    agent_session_attempts.state,
    agent_session_attempts.context_used,
    agent_session_attempts.context_limit,
    agent_session_attempts.context_source,
    agent_session_attempts.context_at,
    agent_session_attempts.confirmed_model,
    agent_session_attempts.confirmed_model_source,
    agent_session_attempts.confirmed_model_at,
    agent_session_attempts.confirmed_reasoning,
    agent_session_attempts.confirmed_reasoning_source,
    agent_session_attempts.confirmed_reasoning_at,
    agent_session_attempts.workspace_directory,
    agent_session_attempts.git_state,
    agent_session_attempts.git_reference,
    agent_session_attempts.workspace_at,
    agent_session_attempts.updated_at`;

/** The columns of a turn's usage, in the order {@link readUsageRow} reads them. */
export const USAGE_COLUMNS = `
    agent_session_turn_usage.attempt_id,
    agent_session_turn_usage.turn,
    agent_session_turn_usage.provider,
    agent_session_turn_usage.model,
    agent_session_turn_usage.input_tokens,
    agent_session_turn_usage.output_tokens,
    agent_session_turn_usage.cache_read_tokens,
    agent_session_turn_usage.cache_write_tokens,
    agent_session_turn_usage.total_tokens,
    agent_session_turn_usage.input_includes_cache,
    agent_session_turn_usage.is_partial,
    agent_session_turn_usage.reported_at`;

/** The columns of a message, in the order {@link readMessageRow} reads them. */
export const MESSAGE_COLUMNS = `
    id,
    attempt_id,
    user_id,
    kind,
    body,
    status,
    created_at,
    updated_at`;

function oneOf<Value extends string>(
  input: string,
  values: readonly Value[],
  column: string,
): Value {
  const match = values.find((value) => value === input);
  if (match === undefined)
    throw new Error(`Database returned an invalid value for "${column}".`);
  return match;
}

function nullableCount(row: Row, index: number, column: string): number | null {
  return row[index] === null || row[index] === undefined
    ? null
    : readCountColumn(row, index, column);
}

function readReported(row: Row, index: number): AgentSessionReportedValue {
  const value = readNullableTextColumn(row, index, "confirmed_value");
  const source = readNullableTextColumn(row, index + 1, "confirmed_source");
  return {
    value,
    source:
      value === null || source === null
        ? null
        : oneOf(source, VALUE_SOURCES, "confirmed_source"),
    reportedAt:
      value === null
        ? null
        : readNullableTextColumn(row, index + 2, "confirmed_at"),
  };
}

function readContext(row: Row): AgentSessionContextUsage {
  const contextUsed = nullableCount(row, 9, "context_used");
  const contextLimit = nullableCount(row, 10, "context_limit");
  const source = readNullableTextColumn(row, 11, "context_source");
  return {
    contextUsed,
    contextLimit,
    percent:
      contextUsed === null || contextLimit === null || contextLimit === 0
        ? null
        : Math.round((contextUsed / contextLimit) * 1_000) / 10,
    source: source === "acp_usage_update" ? source : null,
    reportedAt: readNullableTextColumn(row, 12, "context_at"),
  };
}

function readGit(row: Row): AgentSessionGitState {
  const state = readNullableTextColumn(row, 20, "git_state");
  const reference = readNullableTextColumn(row, 21, "git_reference") ?? "";
  if (state === "branch") return { state, branch: reference };
  if (state === "detached") return { state, commit: reference };
  if (state === "no_repository") return { state };
  return { state: "unreadable" };
}

/** Reads an attempt selected with {@link ATTEMPT_COLUMNS}. */
export function readAttemptRow(row: Row): AgentSessionAttemptRecord {
  const directory = readNullableTextColumn(row, 19, "workspace_directory");
  return {
    key: {
      attemptId: readTextColumn(row, 0, "attempt_id"),
      planId: readTextColumn(row, 1, "plan_id"),
      runId: readTextColumn(row, 2, "run_id"),
      stepId: readTextColumn(row, 3, "step_id"),
    },
    userId: readTextColumn(row, 4, "user_id"),
    provider: oneOf(readTextColumn(row, 5, "provider"), PROVIDERS, "provider"),
    instanceId: readTextColumn(row, 6, "instance_id"),
    groupId: readNullableTextColumn(row, 7, "group_id"),
    state: oneOf(readTextColumn(row, 8, "state"), STATES, "state"),
    context: readContext(row),
    confirmedModel: readReported(row, 13),
    confirmedReasoning: readReported(row, 16),
    workspace:
      directory === null
        ? null
        : {
            directory,
            git: readGit(row),
            checkedAt: readTextColumn(row, 22, "workspace_at"),
          },
    updatedAt: readTextColumn(row, 23, "updated_at"),
  };
}

/**
 * Reads an event selected as sequence, turn, kind, body, truncation, time and node.
 *
 * @param row - The row of the event.
 * @param attemptId - The attempt the caller read.
 */
export function readEventRow(row: Row, attemptId: string): AgentSessionEvent {
  const sequence = readCountColumn(row, 0, "sequence");
  return {
    id: `${attemptId}:${sequence}`,
    sequence,
    turn: nullableCount(row, 1, "turn"),
    kind: oneOf(readTextColumn(row, 2, "kind"), EVENT_KINDS, "kind"),
    text: readTextColumn(row, 3, "body"),
    isTruncated: readBooleanColumn(row, 4, "is_truncated"),
    createdAt: readTextColumn(row, 5, "created_at"),
    stepId: readTextColumn(row, 6, "step_id"),
    attemptId,
  };
}

/** Reads a turn's usage selected with {@link USAGE_COLUMNS}. */
export function readUsageRow(row: Row): AgentSessionTurnUsage {
  return {
    attemptId: readTextColumn(row, 0, "attempt_id"),
    turn: readCountColumn(row, 1, "turn"),
    provider: oneOf(readTextColumn(row, 2, "provider"), PROVIDERS, "provider"),
    model: readNullableTextColumn(row, 3, "model"),
    inputTokens: nullableCount(row, 4, "input_tokens"),
    outputTokens: nullableCount(row, 5, "output_tokens"),
    cacheReadTokens: nullableCount(row, 6, "cache_read_tokens"),
    cacheWriteTokens: nullableCount(row, 7, "cache_write_tokens"),
    totalTokens: nullableCount(row, 8, "total_tokens"),
    inputIncludesCache: readNullableBooleanColumn(
      row,
      9,
      "input_includes_cache",
    ),
    isPartial: readBooleanColumn(row, 10, "is_partial"),
    reportedAt: readTextColumn(row, 11, "reported_at"),
  };
}

/** Reads a message selected with {@link MESSAGE_COLUMNS}. */
export function readMessageRow(row: Row): AgentSessionMessage {
  const kind = readTextColumn(row, 3, "kind");
  return {
    id: readTextColumn(row, 0, "id"),
    attemptId: readTextColumn(row, 1, "attempt_id"),
    userId: readTextColumn(row, 2, "user_id"),
    kind: kind === "repair" ? "repair" : "instruction",
    text: readTextColumn(row, 4, "body"),
    status: oneOf(readTextColumn(row, 5, "status"), MESSAGE_STATUSES, "status"),
    createdAt: readTextColumn(row, 6, "created_at"),
    updatedAt: readTextColumn(row, 7, "updated_at"),
  };
}

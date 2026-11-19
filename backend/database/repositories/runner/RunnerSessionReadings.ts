import {
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";
import type { RunnerSessionReading } from "@/definition/RunnerSessionReading";

interface SessionReadingInput {
  /** The attempt the authenticated runner binding names; never taken from the reading. */
  readonly attemptId: string;
  readonly reading: RunnerSessionReading;
  /** When the runner recorded the event. */
  readonly reportedAt: string;
}

/** The providers whose runner job sends session readings, with the sources of their own measurements. */
const READING_SOURCES = {
  claude_code: ["cli_assistant_usage", "cli_compact_boundary"],
  codex_cli: ["codex_token_count"],
  antigravity: ["acp_usage_update"],
  opencode: ["acp_usage_update"],
  openrouter: ["acp_usage_update"],
  zai: ["acp_usage_update"],
} as const;

type ReadingProvider = keyof typeof READING_SOURCES;

function isReadingProvider(provider: string): provider is ReadingProvider {
  return Object.hasOwn(READING_SOURCES, provider);
}

interface StoredSession {
  readonly provider: ReadingProvider;
  readonly model: string | null;
  readonly modelAt: string | null;
  readonly used: number | null;
  readonly limit: number | null;
  readonly source: string | null;
  readonly contextAt: string | null;
}

interface NextContext {
  readonly used: number | null;
  readonly limit: number | null;
  readonly source: string | null;
  readonly at: string | null;
}

async function readStored(
  transaction: DatabaseTransaction,
  attemptId: string,
): Promise<StoredSession | null> {
  const [row] = await transaction.query(
    `
    SELECT
        provider,
        confirmed_model,
        confirmed_model_at,
        context_used,
        context_limit,
        context_source,
        context_at
    FROM agent_session_attempts
    WHERE attempt_id = $attempt_id
    FOR UPDATE;
  `,
    { attempt_id: attemptId },
  );
  if (!row) return null;
  const provider = readTextColumn(row, 0, "provider");
  if (!isReadingProvider(provider)) return null;
  return {
    provider,
    model: readNullableTextColumn(row, 1, "confirmed_model"),
    modelAt: readNullableTextColumn(row, 2, "confirmed_model_at"),
    used: readNullableCountColumn(row, 3, "context_used"),
    limit: readNullableCountColumn(row, 4, "context_limit"),
    source: readNullableTextColumn(row, 5, "context_source"),
    contextAt: readNullableTextColumn(row, 6, "context_at"),
  };
}

/**
 * Keeps each reported value for the same model and attempt.
 */
function nextContext(
  stored: StoredSession,
  input: SessionReadingInput,
): NextContext {
  const { reading } = input;
  const isSameModel = stored.model === reading.model;
  const kept: NextContext = isSameModel
    ? {
        used: stored.used,
        limit: stored.limit,
        source: stored.source,
        at: stored.contextAt,
      }
    : { used: null, limit: null, source: null, at: null };
  const { context } = reading;
  if (!context || (context.used === null && context.limit === null))
    return kept;
  return {
    used: context.used ?? kept.used,
    limit: context.limit ?? kept.limit,
    source: context.source,
    at: input.reportedAt,
  };
}

function isLate(stored: StoredSession, reportedAt: string): boolean {
  return [stored.modelAt, stored.contextAt].some(
    (time) => time !== null && time > reportedAt,
  );
}

/** The model and reasoning columns of a reading, keeping older values where nothing changed. */
function modelColumns(
  stored: StoredSession,
  input: SessionReadingInput,
  isAcp: boolean,
  isSameModel: boolean,
): SqlParameters {
  const reportedReasoning = isAcp ? input.reading.reasoning : undefined;
  return {
    confirmed_model: input.reading.model,
    confirmed_model_source: isAcp ? "adapter_selector" : "cli_stream_event",
    confirmed_model_at:
      isSameModel && stored.modelAt !== null
        ? stored.modelAt
        : input.reportedAt,
    updates_reasoning:
      isAcp && (reportedReasoning !== undefined || !isSameModel),
    reasoning: reportedReasoning ?? null,
    reasoning_source:
      reportedReasoning === undefined ? null : "adapter_selector",
    reasoning_at: reportedReasoning === undefined ? null : input.reportedAt,
  };
}

/**
 * Stores the model and context a native job reported on its attempt.
 * @remarks
 * Runs in the receipt transaction after the runner binding of plan, run,
 * step, attempt and instance was checked. A reading can only use a context
 * source of its provider. Older readings never replace newer values.
 */
export async function persistRunnerSessionReading(
  transaction: DatabaseTransaction,
  input: SessionReadingInput,
): Promise<void> {
  const stored = await readStored(transaction, input.attemptId);
  if (stored === null || isLate(stored, input.reportedAt)) return;
  const sources: readonly string[] = READING_SOURCES[stored.provider];
  const source = input.reading.context?.source;
  if (source !== undefined && !sources.includes(source)) return;
  const isSameModel = stored.model === input.reading.model;
  if (source === "acp_usage_update" && !isSameModel) return;
  const context = nextContext(stored, input);
  const isAcp = sources.includes("acp_usage_update");
  await transaction.execute(
    `
    UPDATE agent_session_attempts
    SET confirmed_model = $confirmed_model,
        confirmed_model_source = $confirmed_model_source,
        confirmed_model_at = $confirmed_model_at,
        confirmed_reasoning = CASE
            WHEN $updates_reasoning THEN $reasoning
            ELSE confirmed_reasoning
        END,
        confirmed_reasoning_source = CASE
            WHEN $updates_reasoning THEN $reasoning_source
            ELSE confirmed_reasoning_source
        END,
        confirmed_reasoning_at = CASE
            WHEN $updates_reasoning THEN $reasoning_at
            ELSE confirmed_reasoning_at
        END,
        context_used = $context_used,
        context_limit = $context_limit,
        context_source = $context_source,
        context_at = $context_at
    WHERE attempt_id = $attempt_id;
  `,
    {
      attempt_id: input.attemptId,
      ...modelColumns(stored, input, isAcp, isSameModel),
      context_used: context.used,
      context_limit: context.limit,
      context_source: context.source,
      context_at: context.at,
    },
  );
}

import {
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
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
  opencode: ["acp_usage_update"],
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
    WHERE attempt_id = $attempt_id;
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
 * The window Claude Code last reported for a model in any attempt.
 * @remarks
 * The Claude Code CLI names a window only in the result at the end of a
 * turn, and a plan step is one turn. A window is a property of the model, so
 * the one an earlier attempt of the same model stored lets a running step
 * show its occupancy against the window before its own result arrives. Only
 * a window a CLI job reported counts: an ACP adapter guesses one from the
 * model name until its first result.
 */
async function knownModelWindow(
  transaction: DatabaseTransaction,
  model: string,
): Promise<number | null> {
  const [row] = await transaction.query(
    `
    SELECT context_limit
    FROM agent_session_attempts
    WHERE provider = 'claude_code'
        AND confirmed_model = $model
        AND context_limit IS NOT NULL
        AND context_source = ANY(string_to_array($sources, ','))
    ORDER BY context_at DESC NULLS LAST
    LIMIT 1;
  `,
    { model, sources: READING_SOURCES.claude_code.join(",") },
  );
  return row ? readNullableCountColumn(row, 0, "context_limit") : null;
}

/**
 * The context to store after a reading.
 * @remarks
 * The last reported value stays until a new one comes: a reading without a
 * measurement, also a compaction that kept no count, keeps the last valid
 * occupancy of the same model, also into the next turn, and another model
 * drops it. Claude Code can use an earlier attempt's window for the same
 * model until it reports its own. Codex supplies the window of its session.
 */
async function nextContext(
  transaction: DatabaseTransaction,
  stored: StoredSession,
  input: SessionReadingInput,
): Promise<NextContext> {
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
  if (stored.provider === "opencode")
    return context === null ? kept : { ...context, at: input.reportedAt };
  const limit = context?.limit ?? kept.limit;
  const window =
    limit === null && stored.provider === "claude_code"
      ? await knownModelWindow(transaction, reading.model)
      : limit;
  if (!context || context.used === null) return { ...kept, limit: window };
  return {
    used: context.used,
    limit: window,
    source: context.source,
    at: input.reportedAt,
  };
}

function isLate(stored: StoredSession, reportedAt: string): boolean {
  return [stored.modelAt, stored.contextAt].some(
    (time) => time !== null && time > reportedAt,
  );
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
  if (
    stored.provider === "opencode" &&
    source !== undefined &&
    stored.model !== input.reading.model
  )
    return;
  const context = await nextContext(transaction, stored, input);
  const isSameModel = stored.model === input.reading.model;
  await transaction.execute(
    `
    UPDATE agent_session_attempts
    SET confirmed_model = $confirmed_model,
        confirmed_model_source = $confirmed_model_source,
        confirmed_model_at = $confirmed_model_at,
        context_used = $context_used,
        context_limit = $context_limit,
        context_source = $context_source,
        context_at = $context_at
    WHERE attempt_id = $attempt_id;
  `,
    {
      attempt_id: input.attemptId,
      confirmed_model: input.reading.model,
      confirmed_model_source:
        stored.provider === "opencode"
          ? "adapter_selector"
          : "cli_stream_event",
      confirmed_model_at:
        isSameModel && stored.modelAt !== null
          ? stored.modelAt
          : input.reportedAt,
      context_used: context.used,
      context_limit: context.limit,
      context_source: context.source,
      context_at: context.at,
    },
  );
}

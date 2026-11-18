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

interface StoredSession {
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
  if (!row || readTextColumn(row, 0, "provider") !== "claude_code") return null;
  return {
    model: readNullableTextColumn(row, 1, "confirmed_model"),
    modelAt: readNullableTextColumn(row, 2, "confirmed_model_at"),
    used: readNullableCountColumn(row, 3, "context_used"),
    limit: readNullableCountColumn(row, 4, "context_limit"),
    source: readNullableTextColumn(row, 5, "context_source"),
    contextAt: readNullableTextColumn(row, 6, "context_at"),
  };
}

/**
 * The window the CLI last reported for a model in any Claude Code attempt.
 * @remarks
 * The CLI names a window only in the result at the end of a turn, and a plan
 * step is one turn. A window is a property of the model, so the one an
 * earlier attempt of the same model stored lets a running step show its
 * occupancy against the window before its own result arrives. Only a window
 * a CLI job reported counts: an ACP adapter guesses one from the model name
 * until its first result.
 */
async function knownModelWindow(
  transaction: DatabaseTransaction,
  model: string,
): Promise<number | null> {
  const [row] = await transaction.query(
    `
    SELECT context_limit
    FROM agent_session_attempts
    WHERE provider = $provider
        AND confirmed_model = $model
        AND context_limit IS NOT NULL
        AND context_source IN ('cli_assistant_usage', 'cli_compact_boundary')
    ORDER BY context_at DESC NULLS LAST
    LIMIT 1;
  `,
    { provider: "claude_code", model },
  );
  return row ? readNullableCountColumn(row, 0, "context_limit") : null;
}

/**
 * The context to store after a reading.
 * @remarks
 * The last reported value stays until a new one comes: a reading without a
 * measurement, also a compaction that kept no count, keeps the last valid
 * occupancy of the same model, also into the next turn, and another model
 * drops it. A window is a property of the model, so a measurement without
 * one keeps the known window of the same model, else the window an earlier
 * attempt of that model stored.
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
  const limit =
    reading.context?.limit ??
    kept.limit ??
    (await knownModelWindow(transaction, reading.model));
  if (reading.context?.used === null || reading.context?.used === undefined)
    return { ...kept, limit };
  return {
    used: reading.context.used,
    limit,
    source: reading.context.source,
    at: input.reportedAt,
  };
}

function isLate(stored: StoredSession, reportedAt: string): boolean {
  return [stored.modelAt, stored.contextAt].some(
    (time) => time !== null && time > reportedAt,
  );
}

/**
 * Stores the model and context a Claude Code CLI job reported on its attempt.
 * @remarks
 * Runs in the receipt transaction after the runner binding of plan, run,
 * step, attempt and instance was checked. Only Claude Code attempts take a
 * reading. A reading older than the stored values never replaces them, so a
 * repeated or late batch changes nothing. The model counts as reported by
 * the CLI; a reasoning level is never confirmed here, because the CLI echoes
 * none.
 */
export async function persistRunnerSessionReading(
  transaction: DatabaseTransaction,
  input: SessionReadingInput,
): Promise<void> {
  const stored = await readStored(transaction, input.attemptId);
  if (stored === null || isLate(stored, input.reportedAt)) return;
  const context = await nextContext(transaction, stored, input);
  const isSameModel = stored.model === input.reading.model;
  await transaction.execute(
    `
    UPDATE agent_session_attempts
    SET confirmed_model = $confirmed_model,
        confirmed_model_source = 'cli_stream_event',
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

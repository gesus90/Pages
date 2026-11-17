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
 * The context to store after a reading.
 * @remarks
 * A reading without a measurement keeps the last valid one of the same
 * model, also into the next turn, and drops it for another model. A window
 * is a property of the model, so a measurement without one keeps the known
 * window of the same model; a compaction therefore resets the occupancy and
 * keeps the window.
 */
function nextContext(
  stored: StoredSession,
  input: SessionReadingInput,
): NextContext {
  const { reading } = input;
  const isSameModel = stored.model === reading.model;
  if (reading.context === null)
    return isSameModel
      ? {
          used: stored.used,
          limit: stored.limit,
          source: stored.source,
          at: stored.contextAt,
        }
      : { used: null, limit: null, source: null, at: null };
  return {
    used: reading.context.used,
    limit: reading.context.limit ?? (isSameModel ? stored.limit : null),
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
  const context = nextContext(stored, input);
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

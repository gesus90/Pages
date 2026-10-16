import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { CHAT_JOB_STATES } from "@/definition/ChatJob";
import { readChatJobEvent } from "@/definition/ChatJobReader";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  ChatContextUsage,
  ChatCost,
  ChatJob,
  ChatJobEntry,
  ChatJobEvent,
  ChatJobState,
  ChatTokenUsage,
} from "@/definition/ChatJob";

/** What a new job is created from. */
export interface NewChatJob {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly messageId: string;
}

const JOB_COLUMNS = `
    chat_jobs.id,
    chat_jobs.session_id,
    chat_jobs.state,
    chat_jobs.error_code,
    chat_jobs.created_at,
    chat_jobs.ended_at,
    chat_jobs.context_used,
    chat_jobs.context_size,
    chat_jobs.cost_amount,
    chat_jobs.cost_currency,
    (
        SELECT SUM(chat_job_turns.input_tokens)
        FROM chat_job_turns
        WHERE chat_job_turns.job_id = chat_jobs.id
    ) AS input_tokens,
    (
        SELECT SUM(chat_job_turns.output_tokens)
        FROM chat_job_turns
        WHERE chat_job_turns.job_id = chat_jobs.id
    ) AS output_tokens,
    (
        SELECT SUM(chat_job_turns.total_tokens)
        FROM chat_job_turns
        WHERE chat_job_turns.job_id = chat_jobs.id
    ) AS total_tokens,
    (
        SELECT COUNT(*)
        FROM chat_job_turns
        WHERE chat_job_turns.job_id = chat_jobs.id
            AND chat_job_turns.total_tokens IS NULL
    ) AS unreported_turns`;

function nullableCount(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number | null {
  return row[index] === null || row[index] === undefined
    ? null
    : readCountColumn(row, index, column);
}

function readState(input: string): ChatJobState {
  const state = CHAT_JOB_STATES.find((entry) => entry === input);
  if (state === undefined) throw new Error("Invalid chat job state");
  return state;
}

function readContext(row: readonly DatabaseValue[]): ChatContextUsage | null {
  const used = nullableCount(row, 6, "context_used");
  const size = nullableCount(row, 7, "context_size");
  return used === null || size === null ? null : { used, size };
}

function readCost(row: readonly DatabaseValue[]): ChatCost | null {
  const amount = row[8];
  const currency = readNullableTextColumn(row, 9, "cost_currency");
  return typeof amount === "number" && currency !== null
    ? { amount, currency }
    : null;
}

function readTokens(row: readonly DatabaseValue[]): ChatTokenUsage | null {
  const total = nullableCount(row, 12, "total_tokens");
  if (total === null) return null;
  return {
    input: nullableCount(row, 10, "input_tokens") ?? 0,
    output: nullableCount(row, 11, "output_tokens") ?? 0,
    total,
    isPartial: readCountColumn(row, 13, "unreported_turns") > 0,
  };
}

function readJob(row: readonly DatabaseValue[]): ChatJob {
  return {
    id: readTextColumn(row, 0, "id"),
    sessionId: readTextColumn(row, 1, "session_id"),
    state: readState(readTextColumn(row, 2, "state")),
    errorCode: readNullableTextColumn(row, 3, "error_code"),
    createdAt: readTextColumn(row, 4, "created_at"),
    endedAt: readNullableTextColumn(row, 5, "ended_at"),
    usage: {
      context: readContext(row),
      tokens: readTokens(row),
      cost: readCost(row),
    },
  };
}

/**
 * Server-side Pica jobs, their journal and their consumption (PAGE-68).
 *
 * @remarks
 * Every read is bound to the owner of the job. The journal is append-only and
 * numbered contiguously per job, so a reader that continues after its cursor
 * misses nothing and reads nothing twice.
 */
export class ChatJobRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Creates a running job for a stored message. */
  public async create(job: NewChatJob): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_jobs (
          id,
          session_id,
          user_id,
          message_id,
          state
      )
      VALUES (
          $id,
          $session_id,
          $user_id,
          $message_id,
          'running'
      );
    `,
      {
        id: job.id,
        session_id: job.sessionId,
        user_id: job.userId,
        message_id: job.messageId,
      },
    );
  }

  /** Ends a running job once; an ended job keeps its first end. */
  public async finish(
    id: string,
    state: Exclude<ChatJobState, "running">,
    errorCode: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE chat_jobs
      SET
          state = $state,
          error_code = $error_code,
          ended_at = utc_now()
      WHERE id = $id
          AND state = 'running';
    `,
      { id, state, error_code: errorCode },
    );
  }

  /** Replaces the latest context occupancy and cost; a report never adds to an earlier one. */
  public async saveContext(
    id: string,
    context: ChatContextUsage,
    cost: ChatCost | null,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE chat_jobs
      SET
          context_used = $context_used,
          context_size = $context_size,
          cost_amount = $cost_amount,
          cost_currency = $cost_currency
      WHERE id = $id;
    `,
      {
        id,
        context_used: context.used,
        context_size: context.size,
        cost_amount: cost?.amount ?? null,
        cost_currency: cost?.currency ?? null,
      },
    );
  }

  /** Stores the tokens of one turn; a second report of the same turn replaces the first. */
  public async saveTurn(
    id: string,
    turn: number,
    tokens: Omit<ChatTokenUsage, "isPartial"> | null,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_job_turns (
          job_id,
          turn,
          input_tokens,
          output_tokens,
          total_tokens
      )
      VALUES (
          $job_id,
          $turn,
          $input_tokens,
          $output_tokens,
          $total_tokens
      )
      ON CONFLICT (job_id, turn) DO UPDATE SET
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          total_tokens = excluded.total_tokens;
    `,
      {
        job_id: id,
        turn,
        input_tokens: tokens?.input ?? null,
        output_tokens: tokens?.output ?? null,
        total_tokens: tokens?.total ?? null,
      },
    );
  }

  /** Appends one journal entry; the caller numbers the entries of a job. */
  public async append(
    id: string,
    sequence: number,
    event: ChatJobEvent,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_job_events (
          job_id,
          sequence,
          payload
      )
      VALUES (
          $job_id,
          $sequence,
          $payload
      );
    `,
      { job_id: id, sequence, payload: JSON.stringify(event) },
    );
  }

  /** Returns an own job. */
  public async find(userId: string, id: string): Promise<ChatJob | null> {
    const rows = await this.database.query(
      `
      SELECT ${JOB_COLUMNS}
      FROM chat_jobs
      WHERE chat_jobs.id = $id
          AND chat_jobs.user_id = $user_id;
    `,
      { id, user_id: userId },
    );
    return rows.length === 0 ? null : readJob(rows[0]);
  }

  /** Returns the own job a stored message started, or `null` for a message that started none. */
  public async findByMessage(
    userId: string,
    messageId: string,
  ): Promise<ChatJob | null> {
    const rows = await this.database.query(
      `
      SELECT ${JOB_COLUMNS}
      FROM chat_jobs
      WHERE chat_jobs.message_id = $message_id
          AND chat_jobs.user_id = $user_id;
    `,
      { message_id: messageId, user_id: userId },
    );
    return rows.length === 0 ? null : readJob(rows[0]);
  }

  /** Returns the newest job of an own conversation. */
  public async latest(
    userId: string,
    sessionId: string,
  ): Promise<ChatJob | null> {
    const rows = await this.database.query(
      `
      SELECT ${JOB_COLUMNS}
      FROM chat_jobs
      WHERE chat_jobs.session_id = $session_id
          AND chat_jobs.user_id = $user_id
      ORDER BY chat_jobs.created_at DESC, chat_jobs.id DESC
      LIMIT 1;
    `,
      { session_id: sessionId, user_id: userId },
    );
    return rows.length === 0 ? null : readJob(rows[0]);
  }

  /** Reads journal entries of an own job after a cursor, oldest first. */
  public async events(
    userId: string,
    id: string,
    page: { readonly after: number; readonly limit: number },
  ): Promise<readonly ChatJobEntry[]> {
    const rows = await this.database.query(
      `
      SELECT
          chat_job_events.sequence,
          chat_job_events.payload
      FROM chat_job_events
      INNER JOIN chat_jobs
          ON chat_jobs.id = chat_job_events.job_id
      WHERE chat_job_events.job_id = $job_id
          AND chat_jobs.user_id = $user_id
          AND chat_job_events.sequence > $after
      ORDER BY chat_job_events.sequence
      LIMIT $limit;
    `,
      { job_id: id, user_id: userId, after: page.after, limit: page.limit },
    );
    return rows.map((row) => ({
      sequence: readCountColumn(row, 0, "sequence"),
      event: readChatJobEvent(JSON.parse(readTextColumn(row, 1, "payload"))),
    }));
  }

  /**
   * Ends the jobs a previous server process left running; they are never resumed.
   *
   * @returns The IDs of the ended jobs.
   */
  public async interruptRunning(): Promise<readonly string[]> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(`
        UPDATE chat_jobs
        SET
            state = 'interrupted',
            error_code = 'interrupted',
            ended_at = utc_now()
        WHERE state = 'running'
        RETURNING id;
      `);
      const ids = rows.map((row) => readTextColumn(row, 0, "id"));
      for (const id of ids) {
        await transaction.execute(
          `
          UPDATE chat_steers
          SET
              status = 'failed',
              updated_at = utc_now()
          WHERE job_id = $job_id
              AND (
                  status IN ('pending', 'delivered')
                  OR (status = 'followUp' AND answer_message_id IS NULL)
              );
        `,
          { job_id: id },
        );
        await transaction.execute(
          `
          INSERT INTO chat_job_events (
              job_id,
              sequence,
              payload
          )
          SELECT
              $job_id,
              COALESCE(MAX(sequence), 0) + 1,
              $payload
          FROM chat_job_events
          WHERE job_id = $job_id;
        `,
          {
            job_id: id,
            payload: JSON.stringify({
              kind: "end",
              state: "interrupted",
              errorCode: "interrupted",
            } satisfies ChatJobEvent),
          },
        );
      }
      return ids;
    });
  }
}

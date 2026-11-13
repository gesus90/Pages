import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type {
  ConversationObserverFailure,
  ConversationObserverHealth,
} from "@/definition/ConversationObserver";

/** The outcome of one call, as the status views read it. */
export interface ConversationObserverOutcome {
  readonly kind: "routing" | "summary";
  readonly state: "succeeded" | "failed" | "refused";
  readonly errorCode: string | null;
  readonly endedAt: string;
}

function readKind(input: string): ConversationObserverOutcome["kind"] {
  if (input === "routing" || input === "summary") return input;
  throw new Error("Invalid observer run kind");
}

function readState(input: string): ConversationObserverOutcome["state"] {
  if (input === "succeeded" || input === "failed" || input === "refused")
    return input;
  throw new Error("Invalid observer run state");
}

/** A call without result as a failure, or `null` for a success. */
export function observerFailure(
  outcome: ConversationObserverOutcome,
): ConversationObserverFailure | null {
  if (outcome.state === "succeeded") return null;
  return {
    kind: outcome.kind,
    state: outcome.state,
    code: outcome.errorCode ?? "observer_failed",
    at: outcome.endedAt,
  };
}

/** One finished call of the group observer, without prompt or answer. */
export interface ConversationObserverRun {
  readonly id: string;
  readonly conversationId: string;
  readonly kind: "routing" | "summary";
  /** The message or sequence range that caused the call. */
  readonly trigger: string;
  /** The person whose connection access the call used. */
  readonly personId: string;
  readonly connectionId: string | null;
  readonly model: string | null;
  /** `refused` when no model was asked, `failed` when the model call failed. */
  readonly state: "succeeded" | "failed" | "refused";
  readonly errorCode: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly startedAt: string;
  readonly endedAt: string;
}

/**
 * The calls of the group observer with their outcome and token usage
 * (PAGE-296), kept apart from the answers of the agents so their cost stays
 * recognizable.
 */
export class ConversationObserverRunRepository {
  private readonly database: Pick<Database, "execute" | "query">;

  public constructor(database: Pick<Database, "execute" | "query">) {
    this.database = database;
  }

  /** Stores one finished call. */
  public async record(run: ConversationObserverRun): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_observer_runs (
            id,
            conversation_id,
            kind,
            trigger,
            person_id,
            connection_id,
            model,
            state,
            error_code,
            input_tokens,
            output_tokens,
            total_tokens,
            started_at,
            ended_at
        )
        VALUES (
            $id,
            $conversation_id,
            $kind,
            $trigger,
            $person_id,
            $connection_id,
            $model,
            $state,
            $error_code,
            $input_tokens,
            $output_tokens,
            $total_tokens,
            $started_at,
            $ended_at
        );
      `,
      {
        id: run.id,
        conversation_id: run.conversationId,
        kind: run.kind,
        trigger: run.trigger,
        person_id: run.personId,
        connection_id: run.connectionId,
        model: run.model,
        state: run.state,
        error_code: run.errorCode,
        input_tokens: run.inputTokens,
        output_tokens: run.outputTokens,
        total_tokens: run.totalTokens,
        started_at: run.startedAt,
        ended_at: run.endedAt,
      },
    );
  }

  /**
   * The newest calls of one group, newest first.
   *
   * @param conversationId - The group.
   * @param limit - How many calls at most.
   */
  public async latest(
    conversationId: string,
    limit: number,
  ): Promise<readonly ConversationObserverOutcome[]> {
    const rows = await this.database.query(
      `
        SELECT
            kind,
            state,
            error_code,
            ended_at
        FROM conversation_observer_runs
        WHERE conversation_id = $conversation_id
        ORDER BY started_at DESC
        LIMIT $limit;
      `,
      { conversation_id: conversationId, limit },
    );
    return rows.map((row) => ({
      kind: readKind(readTextColumn(row, 0, "kind")),
      state: readState(readTextColumn(row, 1, "state")),
      errorCode: readNullableTextColumn(row, 2, "error_code"),
      endedAt: readTextColumn(row, 3, "ended_at"),
    }));
  }

  /**
   * Counts the calls of all groups since a moment, with the newest failure.
   *
   * @param since - ISO 8601 start of the window.
   */
  public async health(since: string): Promise<ConversationObserverHealth> {
    const counts = await this.database.query(
      `
        SELECT
            state,
            COUNT(*) AS calls,
            MAX(ended_at) AS last_ended_at
        FROM conversation_observer_runs
        WHERE started_at >= $since
        GROUP BY state;
      `,
      { since },
    );
    const [failure] = await this.database.query(
      `
        SELECT
            kind,
            state,
            error_code,
            ended_at
        FROM conversation_observer_runs
        WHERE started_at >= $since
          AND state <> 'succeeded'
        ORDER BY started_at DESC
        LIMIT 1;
      `,
      { since },
    );
    const health = { since, succeeded: 0, failed: 0, refused: 0 };
    let lastSuccessAt: string | null = null;
    for (const row of counts) {
      const state = readState(readTextColumn(row, 0, "state"));
      health[state] = readCountColumn(row, 1, "calls");
      if (state === "succeeded")
        lastSuccessAt = readNullableTextColumn(row, 2, "last_ended_at");
    }
    return {
      ...health,
      lastSuccessAt,
      lastFailure: failure
        ? observerFailure({
            kind: readKind(readTextColumn(failure, 0, "kind")),
            state: readState(readTextColumn(failure, 1, "state")),
            errorCode: readNullableTextColumn(failure, 2, "error_code"),
            endedAt: readTextColumn(failure, 3, "ended_at"),
          })
        : null,
    };
  }
}

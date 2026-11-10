import type { Database } from "@/backend/database/Database";

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
  private readonly database: Pick<Database, "execute">;

  public constructor(database: Pick<Database, "execute">) {
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
}

import {
  readNullableBooleanColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { createInClause } from "@/backend/database/repositories/task/InClause";

import type { Database } from "@/backend/database/Database";
import type {
  ConversationDecisionFallback,
  ConversationDecisionOutcome,
} from "@/definition/ConversationDecision";

/** One decision about one message, with agents as IDs. */
export interface StoredConversationDecision {
  readonly messageId: string;
  readonly conversationId: string;
  readonly outcome: ConversationDecisionOutcome;
  readonly fallback: ConversationDecisionFallback;
  readonly responderIds: readonly string[];
  readonly suggestedIds: readonly string[];
  readonly reason: string;
  readonly needsAnswer: boolean | null;
  readonly createdAt: string;
}

const OUTCOMES: readonly ConversationDecisionOutcome[] = [
  "responders",
  "default",
  "notice",
  "nobody",
];
const FALLBACKS: readonly ConversationDecisionFallback[] = [
  "none",
  "no_model",
  "model_failed",
  "unclear",
];

function readIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

/** The decisions of the decision model about messages of groups (PAGE-317); one per message. */
export class ConversationDecisionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Stores the decision about a message; a second one for the same message changes nothing. */
  public async record(decision: StoredConversationDecision): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_reply_decisions (
            message_id,
            conversation_id,
            outcome,
            fallback,
            responders,
            suggested,
            reason,
            needs_answer,
            created_at
        )
        VALUES (
            $message_id,
            $conversation_id,
            $outcome,
            $fallback,
            $responders,
            $suggested,
            $reason,
            $needs_answer,
            $created_at
        )
        ON CONFLICT (message_id) DO NOTHING;
      `,
      {
        message_id: decision.messageId,
        conversation_id: decision.conversationId,
        outcome: decision.outcome,
        fallback: decision.fallback,
        responders: JSON.stringify(decision.responderIds),
        suggested: JSON.stringify(decision.suggestedIds),
        reason: decision.reason,
        needs_answer: decision.needsAnswer,
        created_at: decision.createdAt,
      },
    );
  }

  /** Reads the decisions about the given messages, by message ID. */
  public async forMessages(
    messageIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredConversationDecision>> {
    const decisions = new Map<string, StoredConversationDecision>();
    if (messageIds.length === 0) return decisions;
    const ids = createInClause("message", messageIds);
    const rows = await this.database.query(
      `
        SELECT
            message_id,
            conversation_id,
            outcome,
            fallback,
            responders,
            suggested,
            reason,
            needs_answer,
            created_at
        FROM conversation_reply_decisions
        WHERE message_id IN (${ids.placeholders});
      `,
      ids.parameters,
    );
    for (const row of rows) {
      const outcome = readTextColumn(row, 2, "outcome");
      const fallback = readTextColumn(row, 3, "fallback");
      const messageId = readTextColumn(row, 0, "message_id");
      decisions.set(messageId, {
        messageId,
        conversationId: readTextColumn(row, 1, "conversation_id"),
        outcome: OUTCOMES.find((entry) => entry === outcome) ?? "nobody",
        fallback: FALLBACKS.find((entry) => entry === fallback) ?? "none",
        responderIds: readIds(readTextColumn(row, 4, "responders")),
        suggestedIds: readIds(readTextColumn(row, 5, "suggested")),
        reason: readTextColumn(row, 6, "reason"),
        needsAnswer: readNullableBooleanColumn(row, 7, "needs_answer"),
        createdAt: readTextColumn(row, 8, "created_at"),
      });
    }
    return decisions;
  }
}

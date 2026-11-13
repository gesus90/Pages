import {
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { createInClause } from "@/backend/database/repositories/task/InClause";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  ConversationDecisionFallback,
  ConversationDecisionOutcome,
} from "@/definition/ConversationDecision";

/** The probability of one option of the question "Which agent is meant?"; no agent is nobody. */
export interface StoredDecisionChoice {
  readonly agentId: string | null;
  readonly probability: number;
}

/** One decision about one message, with agents as IDs. */
export interface StoredConversationDecision {
  readonly messageId: string;
  readonly conversationId: string;
  readonly outcome: ConversationDecisionOutcome;
  readonly fallback: ConversationDecisionFallback;
  readonly responderIds: readonly string[];
  /** The decision model that answered; `null` when none was asked. */
  readonly model: string | null;
  /** The chance that an answer is expected; `null` without a model answer. */
  readonly answerProbability: number | null;
  readonly choices: readonly StoredDecisionChoice[];
  readonly createdAt: string;
}

/** A stored decision with the text of its message, for the list of a group. */
export interface StoredDecisionListing extends StoredConversationDecision {
  readonly text: string;
}

const OUTCOMES: readonly ConversationDecisionOutcome[] = [
  "responders",
  "nobody",
  "mention",
  "unavailable",
];
const FALLBACKS: readonly ConversationDecisionFallback[] = [
  "none",
  "no_model",
  "model_failed",
];

const DECISION_COLUMNS = `
            decisions.message_id,
            decisions.conversation_id,
            decisions.outcome,
            decisions.fallback,
            decisions.responders,
            decisions.model,
            decisions.answer_probability,
            decisions.choices,
            decisions.created_at`;

function readJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function readIds(json: string): string[] {
  const parsed = readJson(json);
  return Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === "string")
    : [];
}

function readChoice(entry: unknown): StoredDecisionChoice[] {
  if (typeof entry !== "object" || entry === null) return [];
  const agentId: unknown = Reflect.get(entry, "agentId");
  const probability: unknown = Reflect.get(entry, "probability");
  if (typeof probability !== "number" || !Number.isFinite(probability))
    return [];
  if (agentId !== null && typeof agentId !== "string") return [];
  return [{ agentId, probability }];
}

function readChoices(json: string): StoredDecisionChoice[] {
  const parsed = readJson(json);
  return Array.isArray(parsed) ? parsed.flatMap(readChoice) : [];
}

function readDecision(
  row: readonly DatabaseValue[],
): StoredConversationDecision {
  const outcome = readTextColumn(row, 2, "outcome");
  const fallback = readTextColumn(row, 3, "fallback");
  return {
    messageId: readTextColumn(row, 0, "message_id"),
    conversationId: readTextColumn(row, 1, "conversation_id"),
    outcome: OUTCOMES.find((entry) => entry === outcome) ?? "nobody",
    fallback: FALLBACKS.find((entry) => entry === fallback) ?? "none",
    responderIds: readIds(readTextColumn(row, 4, "responders")),
    model: readNullableTextColumn(row, 5, "model"),
    answerProbability: readNullableCountColumn(row, 6, "answer_probability"),
    choices: readChoices(readTextColumn(row, 7, "choices")),
    createdAt: readTextColumn(row, 8, "created_at"),
  };
}

/**
 * The decisions about messages of groups (PAGE-317, PAGE-379); one per
 * message, kept with the model, the probabilities and the outcome, also when
 * nobody answers.
 */
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
            model,
            answer_probability,
            choices,
            created_at
        )
        VALUES (
            $message_id,
            $conversation_id,
            $outcome,
            $fallback,
            $responders,
            $model,
            $answer_probability,
            $choices,
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
        model: decision.model,
        answer_probability: decision.answerProbability,
        choices: JSON.stringify(decision.choices),
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
        SELECT ${DECISION_COLUMNS}
        FROM conversation_reply_decisions AS decisions
        WHERE decisions.message_id IN (${ids.placeholders});
      `,
      ids.parameters,
    );
    for (const row of rows) {
      const decision = readDecision(row);
      decisions.set(decision.messageId, decision);
    }
    return decisions;
  }

  /**
   * Reads the decisions that started the given answers.
   *
   * @param replyMessageIds - The answers of agents.
   * @returns The decision of the message each answer followed, by the ID of
   * the answer; only answers the decision model started have one.
   */
  public async forReplies(
    replyMessageIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredConversationDecision>> {
    const decisions = new Map<string, StoredConversationDecision>();
    if (replyMessageIds.length === 0) return decisions;
    const ids = createInClause("reply", replyMessageIds);
    const rows = await this.database.query(
      `
        SELECT
            targets.reply_message_id,
            ${DECISION_COLUMNS}
        FROM conversation_reply_targets AS targets
        INNER JOIN conversation_reply_decisions AS decisions
            ON decisions.message_id = targets.trigger_message_id
        WHERE targets.trigger = 'context'
            AND targets.reply_message_id IN (${ids.placeholders});
      `,
      ids.parameters,
    );
    for (const row of rows)
      decisions.set(
        readTextColumn(row, 0, "reply_message_id"),
        readDecision(row.slice(1)),
      );
    return decisions;
  }

  /**
   * Lists the newest decisions of a group with the text of their messages.
   *
   * @param conversationId - The group.
   * @param limit - The most decisions to list.
   * @returns The newest decisions first.
   */
  public async recent(
    conversationId: string,
    limit: number,
  ): Promise<StoredDecisionListing[]> {
    const rows = await this.database.query(
      `
        SELECT
            ${DECISION_COLUMNS},
            messages.text
        FROM conversation_reply_decisions AS decisions
        INNER JOIN conversation_messages AS messages
            ON messages.id = decisions.message_id
        WHERE decisions.conversation_id = $conversation_id
        ORDER BY decisions.created_at DESC, messages.sequence DESC
        LIMIT $limit;
      `,
      { conversation_id: conversationId, limit },
    );
    return rows.map((row) => ({
      ...readDecision(row),
      text: readTextColumn(row, 9, "text"),
    }));
  }

  /**
   * Tells how the newest call of the decision model of a group went.
   *
   * @param conversationId - The group.
   * @returns The fallback of the newest decision that asked the model, or
   * `null` when the group has none.
   *
   * @remarks
   * A decision that named agents with @ did not ask the model and says
   * nothing about it.
   */
  public async latestFallback(
    conversationId: string,
  ): Promise<ConversationDecisionFallback | null> {
    const [row] = await this.database.query(
      `
        SELECT fallback
        FROM conversation_reply_decisions
        WHERE conversation_id = $conversation_id
            AND outcome <> 'mention'
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      { conversation_id: conversationId },
    );
    if (!row) return null;
    const fallback = readTextColumn(row, 0, "fallback");
    return FALLBACKS.find((entry) => entry === fallback) ?? "none";
  }
}

import { z } from "zod";

import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionStatus,
} from "@/definition/AgentChatQuestion";

/** A stored question of an agent. */
export interface StoredAgentQuestion {
  readonly id: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly items: readonly AgentQuestionItem[];
  /** The only person who may answer; `null` lets every human member answer. */
  readonly responderId: string | null;
  readonly confirmsTool: string | null;
  readonly status: AgentQuestionStatus;
  readonly answers: readonly AgentQuestionAnswer[];
  readonly answeredBy: string | null;
  readonly answeredAt: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** A new question, stored open. */
export type NewAgentQuestion = Omit<
  StoredAgentQuestion,
  "status" | "answers" | "answeredBy" | "answeredAt"
>;

const COLUMNS = `
    id,
    message_id,
    conversation_id,
    agent_id,
    items,
    responder_id,
    confirms_tool,
    status,
    answers,
    answered_by,
    answered_at,
    expires_at,
    created_at
`;

const STATUSES: ReadonlySet<string> = new Set([
  "open",
  "answered",
  "expired",
  "cancelled",
]);

function isStatus(value: string): value is AgentQuestionStatus {
  return STATUSES.has(value);
}

const ITEMS = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    options: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        isRecommended: z.boolean(),
      }),
    ),
    isMultipleChoice: z.boolean(),
  }),
);

const ANSWERS = z.array(
  z.object({
    questionId: z.string(),
    optionIds: z.array(z.string()),
    freeText: z.string().nullable(),
  }),
);

/** Reads a JSON list column that Pages wrote itself; an empty list without one. */
function readList<Entry>(
  text: string | null,
  schema: z.ZodType<Entry[]>,
): readonly Entry[] {
  if (text === null) return [];
  return schema.parse(JSON.parse(text));
}

function toQuestion(row: readonly DatabaseValue[]): StoredAgentQuestion {
  const status = readTextColumn(row, 7, "status");
  if (!isStatus(status))
    throw new Error('Database returned an invalid value for "status".');
  return {
    id: readTextColumn(row, 0, "id"),
    messageId: readTextColumn(row, 1, "message_id"),
    conversationId: readTextColumn(row, 2, "conversation_id"),
    agentId: readTextColumn(row, 3, "agent_id"),
    items: readList(readTextColumn(row, 4, "items"), ITEMS),
    responderId: readNullableTextColumn(row, 5, "responder_id"),
    confirmsTool: readNullableTextColumn(row, 6, "confirms_tool"),
    status,
    answers: readList(readNullableTextColumn(row, 8, "answers"), ANSWERS),
    answeredBy: readNullableTextColumn(row, 9, "answered_by"),
    answeredAt: readNullableTextColumn(row, 10, "answered_at"),
    expiresAt: readTextColumn(row, 11, "expires_at"),
    createdAt: readTextColumn(row, 12, "created_at"),
  };
}

/** Persists the questions of chat agents and their answers. */
export class AgentChatQuestionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Stores a new open question. */
  public async insert(question: NewAgentQuestion): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_chat_questions (
            id, message_id, conversation_id, agent_id, items, responder_id,
            confirms_tool, status, expires_at, created_at
        )
        VALUES (
            $id, $message, $conversation, $agent, $items, $responder,
            $confirms, 'open', $expires, $created
        );
      `,
      {
        id: question.id,
        message: question.messageId,
        conversation: question.conversationId,
        agent: question.agentId,
        items: JSON.stringify(question.items),
        responder: question.responderId,
        confirms: question.confirmsTool,
        expires: question.expiresAt,
        created: question.createdAt,
      },
    );
  }

  /** Reads one question; `null` when none has the ID. */
  public async find(id: string): Promise<StoredAgentQuestion | null> {
    const [row] = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_chat_questions
        WHERE id = $id;
      `,
      { id },
    );
    return row ? toQuestion(row) : null;
  }

  /** Reads the questions carried by the given messages. */
  public async findByMessageIds(
    messageIds: readonly string[],
  ): Promise<readonly StoredAgentQuestion[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_chat_questions
        WHERE message_id = ANY(string_to_array($ids, ','));
      `,
      { ids: messageIds.join(",") },
    );
    return rows.map(toQuestion);
  }

  /**
   * Stores the answer of an open question.
   *
   * @returns Whether the question was still open; an answered or ended one stays as it is.
   */
  public async answer(
    id: string,
    answer: {
      readonly answers: readonly AgentQuestionAnswer[];
      readonly answeredBy: string;
      readonly answeredAt: string;
    },
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_chat_questions
        SET status = 'answered',
            answers = $answers,
            answered_by = $by,
            answered_at = $at
        WHERE id = $id
            AND status = 'open'
        RETURNING id;
      `,
      {
        id,
        answers: JSON.stringify(answer.answers),
        by: answer.answeredBy,
        at: answer.answeredAt,
      },
    );
    return rows.length > 0;
  }

  /** Ends an open question without an answer: expired or cancelled. */
  public async close(
    id: string,
    status: "expired" | "cancelled",
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_chat_questions
        SET status = $status
        WHERE id = $id
            AND status = 'open';
      `,
      { id, status },
    );
  }
}

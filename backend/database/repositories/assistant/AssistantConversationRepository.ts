import { randomUUID } from "node:crypto";

import { readTextColumn } from "@/backend/database/RowValue";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { deleteAssistantConversations } from "./AssistantConversationDeletion";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AssistantConversation,
  AssistantMessage,
  TextAssistantContext,
  TextAssistantChange,
} from "@/definition/TextAssistant";

function readMessage(row: readonly DatabaseValue[]): AssistantMessage {
  const role = readTextColumn(row, 1, "role");
  const change = readTextColumn(row, 3, "change_kind");
  if (
    (role !== "user" && role !== "assistant") ||
    (change !== "answer" && change !== "replace" && change !== "insert")
  )
    throw new TextAssistantError("invalidOutput");
  return {
    id: readTextColumn(row, 0, "id"),
    role,
    text: readTextColumn(row, 2, "content"),
    change,
    createdAt: readTextColumn(row, 4, "created_at"),
  };
}

/** Every history query is bound to an owner and a single context. */
export class AssistantConversationRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Lists this person's conversations; administrators have no alternate read path. */
  public async list(
    userId: string,
    context: TextAssistantContext,
  ): Promise<AssistantConversation[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          last_message_at
      FROM assistant_conversations
      WHERE user_id = $user_id
          AND context_kind = $kind
          AND context_id = $context_id
      ORDER BY last_message_at DESC, id;
    `,
      { user_id: userId, kind: context.kind, context_id: context.id },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      lastMessageAt: readTextColumn(row, 1, "last_message_at"),
    }));
  }

  /** Ownership and context are rechecked even for a known conversation identifier. */
  public async require(
    userId: string,
    context: TextAssistantContext,
    id: string,
  ): Promise<void> {
    const rows = await this.database.query(
      `
      SELECT id
      FROM assistant_conversations
      WHERE id = $id
          AND user_id = $user_id
          AND context_kind = $kind
          AND context_id = $context_id;
    `,
      { id, user_id: userId, kind: context.kind, context_id: context.id },
    );
    if (rows.length === 0) throw new TextAssistantError("conversationMissing");
  }

  /** Opening the assistant never creates a row; only an explicit send calls this. */
  public async create(
    userId: string,
    context: TextAssistantContext,
  ): Promise<string> {
    const id = randomUUID();
    await this.database.execute(
      `
      INSERT INTO assistant_conversations (id, user_id, context_kind, context_id)
      VALUES ($id, $user_id, $kind, $context_id);
    `,
      { id, user_id: userId, kind: context.kind, context_id: context.id },
    );
    return id;
  }

  /** Returns all completed turns in display order after service ownership validation. */
  public async messages(id: string): Promise<AssistantMessage[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          role,
          content,
          change_kind,
          created_at
      FROM assistant_messages
      WHERE conversation_id = $id
      ORDER BY position;
    `,
      { id },
    );
    return rows.map(readMessage);
  }

  /** Stores only complete turns; deletion during execution cannot resurrect history. */
  public async append(
    id: string,
    turn: {
      readonly instruction: string;
      readonly text: string;
      readonly change: TextAssistantChange;
      readonly signal?: AbortSignal;
    },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      turn.signal?.throwIfAborted();
      const updated = await transaction.query(
        `
        UPDATE assistant_conversations
        SET last_message_at = utc_now()
        WHERE id = $id
        RETURNING id;
      `,
        { id },
      );
      if (updated.length === 0)
        throw new TextAssistantError("conversationMissing");
      await transaction.execute(
        `
        INSERT INTO assistant_messages (id, conversation_id, role, content, change_kind, position)
        SELECT
            $message_id,
            $id,
            'user',
            $instruction,
            'answer',
            COALESCE(MAX(position), 0) + 1
        FROM assistant_messages
        WHERE conversation_id = $id;
      `,
        { message_id: randomUUID(), id, instruction: turn.instruction },
      );
      await transaction.execute(
        `
        INSERT INTO assistant_messages (id, conversation_id, role, content, change_kind, position)
        SELECT
            $message_id,
            $id,
            'assistant',
            $content,
            $change_kind,
            MAX(position) + 1
        FROM assistant_messages
        WHERE conversation_id = $id;
      `,
        {
          message_id: randomUUID(),
          id,
          content: turn.text,
          change_kind: turn.change,
        },
      );
      turn.signal?.throwIfAborted();
    });
  }

  /** Deletes an owned conversation; the owner predicate never has an admin override. */
  public async remove(userId: string, id: string): Promise<void> {
    await this.database.transaction((transaction) =>
      deleteAssistantConversations(transaction, {
        condition: "id = $id AND user_id = $user_id",
        parameters: { id, user_id: userId },
      }),
    );
  }

  /** Uses the current instance period for existing histories and purges orphaned contexts. */
  public async sweep(): Promise<void> {
    await this.database.transaction((transaction) =>
      deleteAssistantConversations(transaction, {
        condition: `last_message_at <= utc_after(
          -(SELECT retention_days FROM text_assistant_settings WHERE id = 1) * INTERVAL 1 DAY
      )
      OR NOT EXISTS (SELECT id FROM users WHERE users.id = user_id)
      OR (context_kind = 'wiki' AND NOT EXISTS (
          SELECT id FROM wiki_pages WHERE wiki_pages.id = context_id AND deleted_at IS NULL
      ))
      OR (context_kind = 'ticket' AND NOT EXISTS (
          SELECT id FROM work_items WHERE work_items.id = context_id
      ))`,
        parameters: {},
      }),
    );
  }
}

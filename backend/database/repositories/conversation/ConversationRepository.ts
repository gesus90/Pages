import { PagesEventOutboxRepository } from "@/backend/database/repositories/events/PagesEventOutboxRepository";
import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { PagesEventRecord } from "@/backend/database/repositories/events/PagesEventOutboxRepository";
import type { ConversationKind } from "@/definition/Conversation";

/** Adds one member; a second add changes nothing. */
const INSERT_MEMBER = `
  INSERT INTO conversation_members (
      conversation_id,
      user_id,
      joined_at
  )
  VALUES (
      $conversation_id,
      $user_id,
      $joined_at
  )
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
`;

/** Messages of others after the member's read state. */
const UNREAD_COUNT = `
  (
      SELECT COUNT(*)
      FROM conversation_messages
      WHERE conversation_messages.conversation_id = conversation_members.conversation_id
          AND conversation_messages.sequence > conversation_members.read_sequence
          AND conversation_messages.sender_id <> conversation_members.user_id
  )
`;

/** A conversation as one member sees its stored row. */
export interface ConversationRecord {
  readonly id: string;
  readonly kind: ConversationKind;
  readonly name: string;
  readonly lastActivityAt: string;
  readonly isMuted: boolean;
  readonly unreadCount: number;
}

/** What a new conversation is stored with. */
export interface NewConversation {
  readonly id: string;
  readonly kind: ConversationKind;
  readonly name: string;
  /** The sorted pair of a direct conversation; `null` for a group. */
  readonly directKey: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly memberIds: readonly string[];
}

/** Where a page of the conversation list continues: after this entry. */
export interface ConversationListPosition {
  readonly lastActivityAt: string;
  readonly id: string;
}

type ConversationDatabase = Pick<Database, "query" | "execute" | "transaction">;

function readKind(
  row: readonly DatabaseValue[],
  index: number,
): ConversationKind {
  return readTextColumn(row, index, "kind") === "group" ? "group" : "direct";
}

function toRecord(row: readonly DatabaseValue[]): ConversationRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    kind: readKind(row, 1),
    name: readTextColumn(row, 2, "name"),
    lastActivityAt: readTextColumn(row, 3, "last_activity_at"),
    isMuted: readBooleanColumn(row, 4, "is_muted"),
    unreadCount: readCountColumn(row, 5, "unread_count"),
  };
}

async function insertMembers(
  transaction: Pick<DatabaseTransaction, "execute">,
  conversationId: string,
  memberIds: readonly string[],
  joinedAt: string,
): Promise<void> {
  for (const userId of memberIds)
    await transaction.execute(INSERT_MEMBER, {
      conversation_id: conversationId,
      user_id: userId,
      joined_at: joinedAt,
    });
}

/**
 * The conversations and their members (PAGE-278).
 *
 * @remarks
 * Reads of a member are bound to that member, so a conversation of which an
 * account is no member never answers. A direct conversation exists once per
 * pair: its sorted pair is unique, and creating it twice returns the first.
 */
export class ConversationRepository {
  private readonly database: ConversationDatabase;

  public constructor(database: ConversationDatabase) {
    this.database = database;
  }

  /**
   * Stores a conversation with its members.
   *
   * @param conversation - The new conversation.
   * @param event - The live event that commits with a new conversation.
   * @returns The ID of the stored conversation and whether it is new; for a
   * direct pair that existed already, the ID of that one.
   */
  public async create(
    conversation: NewConversation,
    event: PagesEventRecord,
  ): Promise<{ readonly id: string; readonly isNew: boolean }> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
          INSERT INTO conversations (
              id,
              kind,
              name,
              direct_key,
              created_by,
              created_at,
              last_activity_at
          )
          VALUES (
              $id,
              $kind,
              $name,
              $direct_key,
              $created_by,
              $created_at,
              $created_at
          )
          ON CONFLICT (direct_key) DO NOTHING
          RETURNING id;
        `,
        {
          id: conversation.id,
          kind: conversation.kind,
          name: conversation.name,
          direct_key: conversation.directKey,
          created_by: conversation.createdBy,
          created_at: conversation.createdAt,
        },
      );
      if (rows.length === 0 && conversation.directKey !== null)
        return {
          id: await this.requireDirect(transaction, conversation.directKey),
          isNew: false,
        };
      await insertMembers(
        transaction,
        conversation.id,
        conversation.memberIds,
        conversation.createdAt,
      );
      await new PagesEventOutboxRepository(transaction).append(event);
      return { id: conversation.id, isNew: true };
    });
  }

  /** Tells whether a conversation with the ID exists, whoever its members are. */
  public async exists(conversationId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT id
        FROM conversations
        WHERE id = $id
            AND deleted_agent_id IS NULL;
      `,
      { id: conversationId },
    );
    return rows.length > 0;
  }

  /** Returns the direct conversation of a sorted pair, or `null`. */
  public async findDirect(directKey: string): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT id
        FROM conversations
        WHERE direct_key = $direct_key
            AND deleted_agent_id IS NULL;
      `,
      { direct_key: directKey },
    );
    const [row] = rows;
    return row ? readTextColumn(row, 0, "id") : null;
  }

  /**
   * Adds members to a conversation; existing members stay as they are.
   *
   * @param conversationId - The conversation.
   * @param members - The new members and when they joined.
   * @param event - The live event that commits with the change.
   */
  public async addMembers(
    conversationId: string,
    members: { readonly ids: readonly string[]; readonly joinedAt: string },
    event: PagesEventRecord,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await insertMembers(
        transaction,
        conversationId,
        members.ids,
        members.joinedAt,
      );
      await new PagesEventOutboxRepository(transaction).append(event);
    });
  }

  /** Returns a conversation as the member sees it, or `null` for a non-member. */
  public async findForMember(
    conversationId: string,
    userId: string,
  ): Promise<ConversationRecord | null> {
    const rows = await this.database.query(
      `
        SELECT
            conversations.id,
            conversations.kind,
            conversations.name,
            conversations.last_activity_at,
            conversation_members.is_muted,
            ${UNREAD_COUNT} AS unread_count
        FROM conversation_members
        INNER JOIN conversations
            ON conversations.id = conversation_members.conversation_id
        WHERE conversation_members.conversation_id = $conversation_id
            AND conversation_members.user_id = $user_id
            AND conversations.deleted_agent_id IS NULL;
      `,
      { conversation_id: conversationId, user_id: userId },
    );
    const [row] = rows;
    return row ? toRecord(row) : null;
  }

  /**
   * Returns a page of the member's conversations, the latest activity first.
   *
   * @param userId - The member.
   * @param after - The last entry of the previous page; `null` for the first.
   * @param limit - Entries the page holds at most.
   */
  public async listForMember(
    userId: string,
    after: ConversationListPosition | null,
    limit: number,
  ): Promise<ConversationRecord[]> {
    const rows = await this.database.query(
      `
        SELECT
            conversations.id,
            conversations.kind,
            conversations.name,
            conversations.last_activity_at,
            conversation_members.is_muted,
            ${UNREAD_COUNT} AS unread_count
        FROM conversation_members
        INNER JOIN conversations
            ON conversations.id = conversation_members.conversation_id
        WHERE conversation_members.user_id = $user_id
            AND conversations.deleted_agent_id IS NULL
            AND (
                CAST($after_activity AS TEXT) IS NULL
                OR (conversations.last_activity_at, conversations.id)
                    < (CAST($after_activity AS TEXT), CAST($after_id AS TEXT))
            )
        ORDER BY
            conversations.last_activity_at DESC,
            conversations.id DESC
        LIMIT $limit;
      `,
      {
        user_id: userId,
        after_activity: after?.lastActivityAt ?? null,
        after_id: after?.id ?? null,
        limit,
      },
    );
    return rows.map(toRecord);
  }

  /** Counts every unread message of the member, muted conversations included. */
  public async totalUnread(userId: string): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT COALESCE(SUM(${UNREAD_COUNT}), 0) AS total_unread
        FROM conversation_members
        INNER JOIN conversations
            ON conversations.id = conversation_members.conversation_id
        WHERE conversation_members.user_id = $user_id
            AND conversations.deleted_agent_id IS NULL;
      `,
      { user_id: userId },
    );
    const [row] = rows;
    return row ? readCountColumn(row, 0, "total_unread") : 0;
  }

  /** Returns the member IDs of conversations, in the order they joined. */
  public async memberIds(
    conversationIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const members = new Map<string, string[]>();
    if (conversationIds.length === 0) return members;
    const list = createInClause("conversation", conversationIds);
    const rows = await this.database.query(
      `
        SELECT
            conversation_id,
            conversation_members.user_id
        FROM conversation_members
        INNER JOIN users ON users.id = conversation_members.user_id
        WHERE conversation_id IN (${list.placeholders})
            AND users.removed_at IS NULL
        ORDER BY joined_at, user_id;
      `,
      list.parameters,
    );
    for (const row of rows) {
      const conversationId = readTextColumn(row, 0, "conversation_id");
      const ids = members.get(conversationId) ?? [];
      ids.push(readTextColumn(row, 1, "user_id"));
      members.set(conversationId, ids);
    }
    return members;
  }

  /** Returns which members muted a conversation. */
  public async mutedMemberIds(conversationId: string): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT user_id
        FROM conversation_members
        WHERE conversation_id = $conversation_id
            AND is_muted;
      `,
      { conversation_id: conversationId },
    );
    return new Set(rows.map((row) => readTextColumn(row, 0, "user_id")));
  }

  /** Sets whether a member muted a conversation. */
  public async setMuted(
    conversationId: string,
    userId: string,
    isMuted: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversation_members
        SET is_muted = $is_muted
        WHERE conversation_id = $conversation_id
            AND user_id = $user_id;
      `,
      { conversation_id: conversationId, user_id: userId, is_muted: isMuted },
    );
  }

  /** Moves a member's read state forward to a sequence; it never moves back. */
  public async markRead(
    conversationId: string,
    userId: string,
    sequence: number,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversation_members
        SET read_sequence = GREATEST(read_sequence, $sequence)
        WHERE conversation_id = $conversation_id
            AND user_id = $user_id;
      `,
      { conversation_id: conversationId, user_id: userId, sequence },
    );
  }

  /** Returns the conversation of a direct pair that another call stored first. */
  private async requireDirect(
    transaction: Pick<DatabaseTransaction, "query">,
    directKey: string,
  ): Promise<string> {
    const rows = await transaction.query(
      `
        SELECT id
        FROM conversations
        WHERE direct_key = $direct_key
            AND deleted_agent_id IS NULL;
      `,
      { direct_key: directKey },
    );
    const id = rows[0] ? readNullableTextColumn(rows[0], 0, "id") : null;
    if (id === null)
      throw new Error("The direct conversation of the pair is missing.");
    return id;
  }
}

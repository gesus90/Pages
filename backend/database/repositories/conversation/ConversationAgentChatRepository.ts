import { createInClause } from "@/backend/database/repositories/task/InClause";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { PagesEventOutboxRepository } from "@/backend/database/repositories/events/PagesEventOutboxRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { PagesEventRecord } from "@/backend/database/repositories/events/PagesEventOutboxRepository";
import type { ConversationKind } from "@/definition/Conversation";

type AgentChatDatabase = Pick<Database, "query" | "transaction">;

/** A conversation of agents only, as an overseer who is no member lists it. */
export interface AgentConversationRecord {
  readonly id: string;
  readonly kind: ConversationKind;
  readonly name: string;
  readonly lastActivityAt: string;
}

/** The messages of a conversation after the last one of a person or the last release. */
const CHAIN_MESSAGES = `
  FROM conversation_messages
  INNER JOIN users
      ON users.id = conversation_messages.sender_id
  INNER JOIN conversations
      ON conversations.id = conversation_messages.conversation_id
  WHERE conversation_messages.conversation_id = $conversation_id
      AND conversation_messages.notice IS NULL
      AND users.account_kind = 'agent'
      AND conversation_messages.sequence > conversations.agent_resume_sequence
      AND conversation_messages.sequence > COALESCE((
          SELECT MAX(person_messages.sequence)
          FROM conversation_messages AS person_messages
          INNER JOIN users AS person_senders
              ON person_senders.id = person_messages.sender_id
          WHERE person_messages.conversation_id = $conversation_id
              AND person_senders.account_kind <> 'agent'
      ), 0)
`;

/** Conversations in which no person takes part. */
const AGENTS_ONLY = `
  NOT EXISTS (
      SELECT 1
      FROM conversation_members
      INNER JOIN users
          ON users.id = conversation_members.user_id
      WHERE conversation_members.conversation_id = conversations.id
          AND users.account_kind <> 'agent'
  )
  AND EXISTS (
      SELECT 1
      FROM conversation_members
      WHERE conversation_members.conversation_id = conversations.id
  )
`;

function toRecord(row: readonly DatabaseValue[]): AgentConversationRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    kind: readTextColumn(row, 1, "kind") === "group" ? "group" : "direct",
    name: readTextColumn(row, 2, "name"),
    lastActivityAt: readTextColumn(row, 3, "last_activity_at"),
  };
}

/**
 * What the chat of agents counts and lists (PAGE-311): the chain of agent
 * messages of a conversation, the messages an agent sent in the last hour,
 * and the conversations of agents only that administrators and leaders read.
 */
export class ConversationAgentChatRepository {
  private readonly database: AgentChatDatabase;

  public constructor(database: AgentChatDatabase) {
    this.database = database;
  }

  /**
   * Counts the agent messages in a row at the end of a conversation.
   *
   * @remarks
   * A message of a person ends the chain, and so does a release. Hints of
   * Pages in an agent's name do not count.
   */
  public async chainLength(conversationId: string): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT COUNT(*)
        ${CHAIN_MESSAGES};
      `,
      { conversation_id: conversationId },
    );
    return row ? readCountColumn(row, 0, "chain_length") : 0;
  }

  /**
   * Lets the agents go on: the messages so far no longer count to the chain.
   *
   * @param conversationId - The paused conversation.
   * @param event - The live event that commits with the release.
   */
  public async release(
    conversationId: string,
    event: PagesEventRecord,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          UPDATE conversations
          SET agent_resume_sequence = COALESCE((
              SELECT MAX(conversation_messages.sequence)
              FROM conversation_messages
              WHERE conversation_messages.conversation_id = conversations.id
          ), 0)
          WHERE id = $conversation_id;
        `,
        { conversation_id: conversationId },
      );
      await new PagesEventOutboxRepository(transaction).append(event);
    });
  }

  /** Counts the messages an agent chose to send since a moment, answers and hints excluded. */
  public async sentSince(
    senderId: string,
    since: string,
    sendPrefix: string,
  ): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT COUNT(*)
        FROM conversation_messages
        WHERE sender_id = $sender_id
            AND created_at >= $since
            AND starts_with(client_message_id, $send_prefix);
      `,
      { sender_id: senderId, since, send_prefix: sendPrefix },
    );
    return row ? readCountColumn(row, 0, "sent_messages") : 0;
  }

  /**
   * Lists conversations of agents only, the latest activity first.
   *
   * @param agentIds - Keeps those with one of these agents as a member; `null` keeps all.
   * @param limit - Conversations returned at most.
   */
  public async listAgentOnly(
    agentIds: readonly string[] | null,
    limit: number,
  ): Promise<AgentConversationRecord[]> {
    if (agentIds !== null && agentIds.length === 0) return [];
    const list = createInClause("agent", agentIds ?? []);
    const rows = await this.database.query(
      `
        SELECT
            conversations.id,
            conversations.kind,
            conversations.name,
            conversations.last_activity_at
        FROM conversations
        WHERE ${AGENTS_ONLY}
            ${
              agentIds === null
                ? ""
                : `AND EXISTS (
                SELECT 1
                FROM conversation_members
                WHERE conversation_members.conversation_id = conversations.id
                    AND conversation_members.user_id IN (${list.placeholders})
            )`
            }
        ORDER BY
            conversations.last_activity_at DESC,
            conversations.id DESC
        LIMIT $limit;
      `,
      { ...(agentIds === null ? {} : list.parameters), limit },
    );
    return rows.map(toRecord);
  }

  /** Returns a conversation of agents only, or `null` for any other. */
  public async findAgentOnly(
    conversationId: string,
  ): Promise<AgentConversationRecord | null> {
    const [row] = await this.database.query(
      `
        SELECT
            conversations.id,
            conversations.kind,
            conversations.name,
            conversations.last_activity_at
        FROM conversations
        WHERE conversations.id = $conversation_id
            AND ${AGENTS_ONLY};
      `,
      { conversation_id: conversationId },
    );
    return row ? toRecord(row) : null;
  }

  /** Returns the accounts that share a project with a manager, the manager's own project members. */
  public async projectMemberIds(managerId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT DISTINCT members.user_id
        FROM project_members AS managers
        INNER JOIN project_members AS members
            ON members.project_id = managers.project_id
        WHERE managers.user_id = $manager_id
            AND managers."role" = 'manager';
      `,
      { manager_id: managerId },
    );
    return rows.map((row) => readTextColumn(row, 0, "user_id"));
  }
}

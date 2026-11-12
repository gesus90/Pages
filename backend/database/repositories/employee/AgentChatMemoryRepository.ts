import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { AgentMemoryChat } from "@/definition/AgentMemory";

/** The stored summary of the older part of a chat session of an agent. */
export interface AgentChatSummary {
  readonly summary: string;
  /** The newest message the summary covers. */
  readonly throughId: string;
}

/**
 * What the memory of agents reads about chats (PAGE-305): the summary of a
 * chat session, whether a chat is confidential, and the members of a
 * stored conversation.
 *
 * @remarks
 * A direct chat of a person with an agent is confidential per agent and
 * person; a stored conversation for all its members and agents.
 */
export class AgentChatMemoryRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Returns the summary of a chat session of an agent, or `null`; it lives
   * where Pica keeps the summary of its own sessions.
   */
  public async summary(sessionId: string): Promise<AgentChatSummary | null> {
    const rows = await this.database.query(
      `
        SELECT
            context_summary,
            context_through_id
        FROM chat_sessions
        WHERE id = $session_id;
      `,
      { session_id: sessionId },
    );
    const row = rows[0];
    if (!row) return null;
    const summary = readNullableTextColumn(row, 0, "context_summary");
    const throughId = readNullableTextColumn(row, 1, "context_through_id");
    return summary === null || throughId === null
      ? null
      : { summary, throughId };
  }

  /** Replaces the summary of a chat session of an agent. */
  public async saveSummary(
    sessionId: string,
    summary: AgentChatSummary,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE chat_sessions
        SET
            context_summary = $summary,
            context_through_id = $through_id,
            context_revision = COALESCE(context_revision, 0) + 1
        WHERE id = $session_id;
      `,
      {
        session_id: sessionId,
        summary: summary.summary,
        through_id: summary.throughId,
      },
    );
  }

  /**
   * Whether a chat is marked confidential.
   *
   * @param agentId - The agent whose direct chat is meant; ignored for a conversation.
   * @param chat - The chat.
   */
  public async isConfidential(
    agentId: string,
    chat: AgentMemoryChat,
  ): Promise<boolean> {
    const rows =
      chat.kind === "person"
        ? await this.database.query(
            `
              SELECT is_confidential
              FROM agent_conversations
              WHERE agent_id = $agent_id
                  AND person_id = $person_id
                  AND purpose = 'chat';
            `,
            { agent_id: agentId, person_id: chat.personId },
          )
        : await this.database.query(
            `
              SELECT is_confidential
              FROM conversations
              WHERE id = $conversation_id;
            `,
            { conversation_id: chat.conversationId },
          );
    const row = rows[0];
    return row ? readBooleanColumn(row, 0, "is_confidential") : false;
  }

  /**
   * Marks the direct chat of a person with an agent confidential or not.
   *
   * @returns Whether the chat exists; a chat without any message has none yet.
   */
  public async setDirectConfidential(
    agentId: string,
    personId: string,
    isConfidential: boolean,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_conversations
        SET is_confidential = $is_confidential
        WHERE agent_id = $agent_id
            AND person_id = $person_id
            AND purpose = 'chat'
        RETURNING chat_session_id;
      `,
      {
        agent_id: agentId,
        person_id: personId,
        is_confidential: isConfidential,
      },
    );
    return rows.length > 0;
  }

  /** Marks a stored conversation confidential or not, for all its members. */
  public async setConversationConfidential(
    conversationId: string,
    isConfidential: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversations
        SET is_confidential = $is_confidential
        WHERE id = $conversation_id;
      `,
      { conversation_id: conversationId, is_confidential: isConfidential },
    );
  }

  /** The people among the members of a stored conversation; agents are left out. */
  public async conversationPeople(conversationId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT conversation_members.user_id
        FROM conversation_members
        INNER JOIN users
            ON users.id = conversation_members.user_id
        WHERE conversation_members.conversation_id = $conversation_id
            AND users.account_kind <> 'agent'
        ORDER BY conversation_members.user_id;
      `,
      { conversation_id: conversationId },
    );
    return rows.map((row) => readTextColumn(row, 0, "user_id"));
  }

  /** The agents whose direct chat with the person is marked confidential. */
  public async confidentialAgents(personId: string): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT agent_id
        FROM agent_conversations
        WHERE person_id = $person_id
            AND purpose = 'chat'
            AND is_confidential;
      `,
      { person_id: personId },
    );
    return new Set(rows.map((row) => readTextColumn(row, 0, "agent_id")));
  }

  /** The stored conversations of the person that are marked confidential. */
  public async confidentialConversations(
    personId: string,
  ): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT conversations.id
        FROM conversations
        INNER JOIN conversation_members
            ON conversation_members.conversation_id = conversations.id
        WHERE conversation_members.user_id = $person_id
            AND conversations.is_confidential;
      `,
      { person_id: personId },
    );
    return new Set(rows.map((row) => readTextColumn(row, 0, "id")));
  }

  /** The people whose direct chat with an agent is marked confidential. */
  public async confidentialPeople(agentId: string): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT person_id
        FROM agent_conversations
        WHERE agent_id = $agent_id
            AND purpose = 'chat'
            AND is_confidential;
      `,
      { agent_id: agentId },
    );
    return new Set(rows.map((row) => readTextColumn(row, 0, "person_id")));
  }
}

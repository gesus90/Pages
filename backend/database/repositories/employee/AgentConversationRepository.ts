import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/**
 * Why a conversation of an agent exists: a person's chat with it, its
 * dream runs (`learning`), its answers in a stored conversation (PAGE-276),
 * whose ID then stands in `personId`, the runs of one automation (PAGE-297),
 * whose session key stands there, or the updates of its memory and the
 * summaries of its chats (`memory`, PAGE-305).
 */
export type AgentConversationPurpose =
  "chat" | "learning" | "conversation" | "automation" | "memory";

/** The chat session one person shares with one agent, or the agent's learning session. */
export interface AgentConversation {
  readonly sessionId: string;
  readonly agentId: string;
  readonly personId: string;
  readonly purpose: AgentConversationPurpose;
}

/**
 * Ties the chat sessions of agents to the person they talk with (PAGE-266).
 *
 * @remarks
 * The chat session belongs to the agent's account, so a session runs with
 * the agent's rights; this table names the person it talks with. The
 * learning session of an agent names the agent itself.
 */
export class AgentConversationRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Returns the conversation of a person with an agent, or `null`. */
  public async find(
    agentId: string,
    personId: string,
    purpose: AgentConversationPurpose,
  ): Promise<AgentConversation | null> {
    const rows = await this.database.query(
      `
        SELECT chat_session_id
        FROM agent_conversations
        WHERE agent_id = $agent_id
            AND person_id = $person_id
            AND purpose = $purpose;
      `,
      { agent_id: agentId, person_id: personId, purpose },
    );
    const row = rows[0];
    return row
      ? {
          sessionId: readTextColumn(row, 0, "chat_session_id"),
          agentId,
          personId,
          purpose,
        }
      : null;
  }

  /**
   * Finds the group a name stands for among the groups all given accounts
   * belong to (PAGE-376); the newest when several carry the name.
   *
   * @param name - The name of the group, compared without regard to case.
   * @param memberIds - The accounts that must all be members.
   * @returns The ID of the group, or `null`.
   */
  public async findGroupByName(
    name: string,
    memberIds: readonly string[],
  ): Promise<string | null> {
    const [first = "", second = first] = memberIds;
    const rows = await this.database.query(
      `
        SELECT conversations.id
        FROM conversations
        WHERE conversations.kind = 'group'
            AND lower(conversations.name) = lower($name)
            AND EXISTS (
                SELECT 1
                FROM conversation_members
                WHERE conversation_members.conversation_id = conversations.id
                    AND conversation_members.user_id = $first_member
            )
            AND EXISTS (
                SELECT 1
                FROM conversation_members
                WHERE conversation_members.conversation_id = conversations.id
                    AND conversation_members.user_id = $second_member
            )
        ORDER BY conversations.last_activity_at DESC
        LIMIT 1;
      `,
      { name, first_member: first, second_member: second },
    );
    const [row] = rows;
    return row ? readTextColumn(row, 0, "id") : null;
  }

  /**
   * Returns the conversation, creating it and its chat session owned by the
   * agent when it does not exist yet.
   *
   * @param conversation - Agent, person and purpose.
   * @param sessionId - The unused ID a new chat session takes.
   */
  public async ensure(
    conversation: Omit<AgentConversation, "sessionId">,
    sessionId: string,
  ): Promise<AgentConversation> {
    const { agentId, personId, purpose } = conversation;
    const existing = await this.find(agentId, personId, purpose);
    if (existing) return existing;
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          INSERT INTO chat_sessions (
              id,
              user_id
          )
          VALUES (
              $id,
              $user_id
          );
        `,
        { id: sessionId, user_id: agentId },
      );
      await transaction.execute(
        `
          INSERT INTO agent_conversations (
              chat_session_id,
              agent_id,
              person_id,
              purpose
          )
          VALUES (
              $chat_session_id,
              $agent_id,
              $person_id,
              $purpose
          )
          ON CONFLICT (agent_id, person_id, purpose) DO NOTHING;
        `,
        {
          chat_session_id: sessionId,
          agent_id: agentId,
          person_id: personId,
          purpose,
        },
      );
    });
    const stored = await this.find(agentId, personId, purpose);
    if (!stored) throw new Error("The agent conversation was not stored.");
    return stored;
  }
}

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentHistoryCurrentChat } from "@/definition/AgentChatHistory";

/** One message of a chat of an agent as the history search reads it (PAGE-393). */
export interface StoredHistoryMessage {
  /** `direct` for a message of the direct chat session, `conversation` for a stored conversation. */
  readonly source: "direct" | "conversation";
  readonly chatKind: "direct" | "group";
  /** The person of a direct chat, the conversation of a group. */
  readonly chatId: string;
  readonly chatName: string;
  /** The stored conversation of the message; `null` for the direct chat session. */
  readonly conversationId: string | null;
  readonly messageId: string;
  /** The order inside its source: the position in the session or the sequence of the conversation. */
  readonly position: number;
  readonly senderName: string;
  readonly createdAt: string;
  readonly text: string;
}

/** What a search narrows to; every part narrows the result. */
export interface HistoryFilter {
  /** Words that all appear in the text, compared without regard to case. */
  readonly words: readonly string[];
  /** A part of the chat name or the exact chat ID; `null` for every chat. */
  readonly chat: string | null;
  /** A part of the sender's name; `null` for every sender. */
  readonly sender: string | null;
  /** The earliest ISO time, inclusive; `null` for no bound. */
  readonly since: string | null;
  /** The ISO time the range ends before; `null` for no bound. */
  readonly before: string | null;
  readonly limit: number;
}

/**
 * The messages an agent may find, with the chat they belong to.
 *
 * @remarks
 * Direct chats count while the person keeps the agent in their list
 * (`chat_contacts`); groups and stored direct conversations while the agent
 * is a member and the conversation exists. Notices of Pages are no messages.
 * Deleted messages and dissolved groups have no rows any more. A confidential
 * chat stays out unless it is the chat of the job (`$current_kind` and
 * `$current_id`, or `$current_conversation`), whenever it was marked.
 */
const VISIBLE_MESSAGES = `
    WITH chat_rows AS (
        SELECT
            'direct' AS source,
            'direct' AS chat_kind,
            agent_conversations.person_id AS chat_id,
            'Chat mit ' || people.display_name AS chat_name,
            NULL::TEXT AS conversation_id,
            chat_messages.id AS message_id,
            chat_messages.position::BIGINT AS position,
            CASE
                WHEN chat_messages.role = 'user' THEN people.display_name
                ELSE agents.display_name
            END AS sender_name,
            chat_messages.created_at AS created_at,
            chat_messages.content AS text,
            agent_conversations.is_confidential AS is_confidential
        FROM agent_conversations
        INNER JOIN chat_messages
            ON chat_messages.session_id = agent_conversations.chat_session_id
        INNER JOIN users AS people
            ON people.id = agent_conversations.person_id
        INNER JOIN users AS agents
            ON agents.id = agent_conversations.agent_id
        WHERE agent_conversations.agent_id = $agent_id
            AND agent_conversations.purpose = 'chat'
            AND EXISTS (
                SELECT 1
                FROM chat_contacts
                WHERE chat_contacts.owner_id = agent_conversations.person_id
                    AND chat_contacts.contact_id = agent_conversations.agent_id
            )
        UNION ALL
        SELECT
            'conversation' AS source,
            conversations.kind AS chat_kind,
            CASE
                WHEN conversations.kind = 'direct' THEN partners.user_id
                ELSE conversations.id
            END AS chat_id,
            CASE
                WHEN conversations.kind = 'direct'
                    THEN 'Chat mit ' || COALESCE(partner_users.display_name, 'Unbekannt')
                ELSE conversations.name
            END AS chat_name,
            conversations.id AS conversation_id,
            conversation_messages.id AS message_id,
            conversation_messages.sequence AS position,
            COALESCE(senders.display_name, 'Unbekannt') AS sender_name,
            conversation_messages.created_at AS created_at,
            conversation_messages.text AS text,
            (
                conversations.is_confidential
                OR (
                    conversations.kind = 'direct'
                    AND EXISTS (
                        SELECT 1
                        FROM agent_conversations
                        WHERE agent_conversations.agent_id = $agent_id
                            AND agent_conversations.person_id = partners.user_id
                            AND agent_conversations.purpose = 'chat'
                            AND agent_conversations.is_confidential
                    )
                )
            ) AS is_confidential
        FROM conversation_members AS membership
        INNER JOIN conversations
            ON conversations.id = membership.conversation_id
        INNER JOIN conversation_messages
            ON conversation_messages.conversation_id = conversations.id
        LEFT JOIN users AS senders
            ON senders.id = conversation_messages.sender_id
        LEFT JOIN LATERAL (
            SELECT conversation_members.user_id
            FROM conversation_members
            WHERE conversation_members.conversation_id = conversations.id
                AND conversation_members.user_id <> $agent_id
            ORDER BY conversation_members.user_id
            LIMIT 1
        ) AS partners ON conversations.kind = 'direct'
        LEFT JOIN users AS partner_users
            ON partner_users.id = partners.user_id
        WHERE membership.user_id = $agent_id
            AND conversations.deleted_agent_id IS NULL
            AND conversation_messages.notice IS NULL
    ),
    visible AS (
        SELECT
            source,
            chat_kind,
            chat_id,
            chat_name,
            conversation_id,
            message_id,
            position,
            sender_name,
            created_at,
            text
        FROM chat_rows
        WHERE chat_id IS NOT NULL
            AND (
                NOT is_confidential
                OR (chat_kind = $current_kind AND chat_id = $current_id)
                OR conversation_id = $current_conversation
            )
    )`;

const COLUMNS = `
    visible.source,
    visible.chat_kind,
    visible.chat_id,
    visible.chat_name,
    visible.conversation_id,
    visible.message_id,
    visible.position,
    visible.sender_name,
    visible.created_at,
    visible.text`;

/** A `LIKE` pattern that finds the text as a part of another, with `%` and `_` taken literally. */
function containing(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/gu, "\\$&")}%`;
}

/** The chat of the job as the visibility of confidential chats compares it. */
function currentChat(current: AgentHistoryCurrentChat | null): {
  readonly current_kind: string;
  readonly current_id: string;
  readonly current_conversation: string;
} {
  if (!current)
    return { current_kind: "", current_id: "", current_conversation: "" };
  return current.kind === "direct"
    ? {
        current_kind: "direct",
        current_id: current.personId,
        current_conversation: "",
      }
    : {
        current_kind: "group",
        current_id: current.conversationId,
        current_conversation: current.conversationId,
      };
}

function toMessage(row: readonly DatabaseValue[]): StoredHistoryMessage {
  return {
    source:
      readTextColumn(row, 0, "source") === "direct" ? "direct" : "conversation",
    chatKind:
      readTextColumn(row, 1, "chat_kind") === "group" ? "group" : "direct",
    chatId: readTextColumn(row, 2, "chat_id"),
    chatName: readTextColumn(row, 3, "chat_name"),
    conversationId: readNullableTextColumn(row, 4, "conversation_id"),
    messageId: readTextColumn(row, 5, "message_id"),
    position: readCountColumn(row, 6, "position"),
    senderName: readTextColumn(row, 7, "sender_name"),
    createdAt: readTextColumn(row, 8, "created_at"),
    text: readTextColumn(row, 9, "text"),
  };
}

/** The conditions and values of the narrowing parts of a search. */
function filterConditions(filter: HistoryFilter): {
  readonly conditions: readonly string[];
  readonly parameters: Record<string, string>;
} {
  const parameters: Record<string, string> = {};
  const conditions: string[] = [];
  filter.words.forEach((word, index) => {
    const name = `word_${String(index)}`;
    parameters[name] = containing(word);
    conditions.push(`lower(visible.text) LIKE $${name} ESCAPE '\\'`);
  });
  if (filter.chat !== null) {
    parameters.chat = containing(filter.chat);
    parameters.chat_exact = filter.chat;
    conditions.push(
      "(lower(visible.chat_name) LIKE $chat ESCAPE '\\' OR visible.chat_id = $chat_exact)",
    );
  }
  if (filter.sender !== null) {
    parameters.sender = containing(filter.sender);
    conditions.push("lower(visible.sender_name) LIKE $sender ESCAPE '\\'");
  }
  if (filter.since !== null) {
    parameters.since = filter.since;
    conditions.push("visible.created_at >= $since");
  }
  if (filter.before !== null) {
    parameters.before = filter.before;
    conditions.push("visible.created_at < $before");
  }
  return { conditions, parameters };
}

/**
 * Reads the earlier messages of the chats of an agent for its history search
 * (PAGE-393).
 *
 * @remarks
 * Every read applies the same visibility: only chats the agent is a member
 * of now, a confidential chat only from inside itself, no deleted message,
 * no dissolved group.
 */
export class AgentChatHistoryRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /**
   * Finds the messages that match a search, the newest first.
   *
   * @param agentId - The agent whose chats are searched.
   * @param current - The chat of the job; `null` for a run without a chat.
   * @param filter - The words and the narrowing parts.
   */
  public async search(
    agentId: string,
    current: AgentHistoryCurrentChat | null,
    filter: HistoryFilter,
  ): Promise<StoredHistoryMessage[]> {
    const { conditions, parameters } = filterConditions(filter);
    const where =
      conditions.length === 0 ? "" : `WHERE ${conditions.join("\n AND ")}`;
    const rows = await this.database.query(
      `
        ${VISIBLE_MESSAGES}
        SELECT${COLUMNS}
        FROM visible
        ${where}
        ORDER BY visible.created_at DESC, visible.position DESC
        LIMIT $limit;
      `,
      {
        agent_id: agentId,
        ...currentChat(current),
        ...parameters,
        limit: filter.limit,
      },
    );
    return rows.map(toMessage);
  }

  /**
   * Reads a visible message with the messages before and after it in its chat.
   *
   * @returns The messages in their order, or `null` when the message is not
   * visible to the agent.
   */
  public async around(
    agentId: string,
    current: AgentHistoryCurrentChat | null,
    target: {
      readonly messageId: string;
      readonly before: number;
      readonly after: number;
    },
  ): Promise<{
    readonly hit: StoredHistoryMessage;
    readonly messages: readonly StoredHistoryMessage[];
  } | null> {
    const rows = await this.database.query(
      `
        ${VISIBLE_MESSAGES},
        target AS (
            SELECT source, chat_kind, chat_id, position
            FROM visible
            WHERE message_id = $message_id
            ORDER BY source
            LIMIT 1
        ),
        earlier AS (
            SELECT${COLUMNS}
            FROM visible
            INNER JOIN target
                ON target.source = visible.source
                AND target.chat_kind = visible.chat_kind
                AND target.chat_id = visible.chat_id
            WHERE visible.position < target.position
            ORDER BY visible.position DESC
            LIMIT $before
        ),
        later AS (
            SELECT${COLUMNS}
            FROM visible
            INNER JOIN target
                ON target.source = visible.source
                AND target.chat_kind = visible.chat_kind
                AND target.chat_id = visible.chat_id
            WHERE visible.position >= target.position
            ORDER BY visible.position
            LIMIT $after_and_hit
        )
        SELECT * FROM earlier
        UNION ALL
        SELECT * FROM later
        ORDER BY position;
      `,
      {
        agent_id: agentId,
        ...currentChat(current),
        message_id: target.messageId,
        before: target.before,
        after_and_hit: target.after + 1,
      },
    );
    const messages = rows.map(toMessage);
    const hit = messages.find(
      (message) => message.messageId === target.messageId,
    );
    return hit ? { hit, messages } : null;
  }
}

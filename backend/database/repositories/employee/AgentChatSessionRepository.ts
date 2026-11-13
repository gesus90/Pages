import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentChatKind } from "@/definition/AgentChatSession";

/** One chat session of an agent with its stored state (PAGE-376). */
export interface StoredAgentChatSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly kind: AgentChatKind;
  /** The person of a direct chat or the conversation of a group. */
  readonly chatId: string;
  /** The name of the group, or of the person of a direct chat. */
  readonly chatName: string;
  readonly isConfidential: boolean;
  /** The sequence of the newest conversation message the session received; `0` before the first round. */
  readonly deliveredSequence: number;
  /** The context reached the restart threshold and the session still has to restart. */
  readonly needsRestart: boolean;
  readonly contextUsed: number | null;
  readonly contextSize: number | null;
  readonly tokensTotal: number;
  /** The tokens used on `tokensDay`. */
  readonly tokensToday: number;
  readonly tokensDay: string | null;
  readonly restartCount: number;
  readonly lastActivityAt: string | null;
}

/** What a finished round adds to the state of its session. */
export interface AgentChatSessionUsage {
  readonly contextUsed: number | null;
  readonly contextSize: number | null;
  /** The tokens of the round. */
  readonly tokens: number;
  /** The day of the round, `YYYY-MM-DD` in UTC. */
  readonly day: string;
  readonly at: string;
}

/** What an administrator sets per agent. */
export interface StoredAgentChatSettings {
  /** Minutes until the process of a resting session ends; `null` follows the instance setting. */
  readonly idleMinutes: number | null;
  readonly restartPercent: number;
}

const SESSION_COLUMNS = `
    agent_conversations.chat_session_id,
    agent_conversations.agent_id,
    agent_conversations.purpose,
    agent_conversations.person_id,
    COALESCE(conversations.name, people.display_name, '') AS chat_name,
    COALESCE(
        CASE
            WHEN agent_conversations.purpose = 'chat'
                THEN agent_conversations.is_confidential
            ELSE conversations.is_confidential
        END,
        FALSE
    ) AS is_confidential,
    agent_conversations.delivered_sequence,
    agent_conversations.needs_restart,
    agent_conversations.context_used,
    agent_conversations.context_size,
    agent_conversations.tokens_total,
    agent_conversations.tokens_today,
    agent_conversations.tokens_day,
    agent_conversations.restart_count,
    agent_conversations.last_activity_at`;

const SESSION_SOURCE = `
    FROM agent_conversations
    LEFT JOIN conversations
        ON agent_conversations.purpose = 'conversation'
        AND conversations.id = agent_conversations.person_id
    LEFT JOIN users AS people
        ON agent_conversations.purpose = 'chat'
        AND people.id = agent_conversations.person_id`;

function readOptionalCount(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number | null {
  return row[index] === null ? null : readCountColumn(row, index, column);
}

function toSession(row: readonly DatabaseValue[]): StoredAgentChatSession {
  const purpose = readTextColumn(row, 2, "purpose");
  return {
    sessionId: readTextColumn(row, 0, "chat_session_id"),
    agentId: readTextColumn(row, 1, "agent_id"),
    kind: purpose === "chat" ? "direct" : "group",
    chatId: readTextColumn(row, 3, "person_id"),
    chatName: readTextColumn(row, 4, "chat_name"),
    isConfidential: readBooleanColumn(row, 5, "is_confidential"),
    deliveredSequence: readCountColumn(row, 6, "delivered_sequence"),
    needsRestart: readBooleanColumn(row, 7, "needs_restart"),
    contextUsed: readOptionalCount(row, 8, "context_used"),
    contextSize: readOptionalCount(row, 9, "context_size"),
    tokensTotal: readCountColumn(row, 10, "tokens_total"),
    tokensToday: readCountColumn(row, 11, "tokens_today"),
    tokensDay: readNullableTextColumn(row, 12, "tokens_day"),
    restartCount: readCountColumn(row, 13, "restart_count"),
    lastActivityAt: readNullableTextColumn(row, 14, "last_activity_at"),
  };
}

/**
 * The state of the chat sessions of agents (PAGE-376): what each session has
 * received, how full its context is, what it used, and the settings per agent.
 *
 * @remarks
 * A chat session is a row of `agent_conversations` with the purpose `chat`
 * (the direct chat with a person) or `conversation` (a group); the rows of
 * background runs never count as chat sessions.
 */
export class AgentChatSessionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns every chat session of an agent, the newest activity first. */
  public async list(agentId: string): Promise<StoredAgentChatSession[]> {
    const rows = await this.database.query(
      `
        SELECT${SESSION_COLUMNS}
        ${SESSION_SOURCE}
        WHERE agent_conversations.agent_id = $agent_id
            AND agent_conversations.purpose IN ('chat', 'conversation')
        ORDER BY
            agent_conversations.last_activity_at DESC NULLS LAST,
            agent_conversations.chat_session_id;
      `,
      { agent_id: agentId },
    );
    return rows.map(toSession);
  }

  /** Returns one chat session, or `null` for an unknown ID or a background run. */
  public async find(sessionId: string): Promise<StoredAgentChatSession | null> {
    const rows = await this.database.query(
      `
        SELECT${SESSION_COLUMNS}
        ${SESSION_SOURCE}
        WHERE agent_conversations.chat_session_id = $session_id
            AND agent_conversations.purpose IN ('chat', 'conversation');
      `,
      { session_id: sessionId },
    );
    const [row] = rows;
    return row ? toSession(row) : null;
  }

  /** The chat sessions of agents that take part in one chat: a direct chat of the person, or a conversation. */
  public async forChat(
    kind: AgentChatKind,
    chatId: string,
  ): Promise<StoredAgentChatSession[]> {
    const rows = await this.database.query(
      `
        SELECT${SESSION_COLUMNS}
        ${SESSION_SOURCE}
        WHERE agent_conversations.person_id = $chat_id
            AND agent_conversations.purpose = $purpose;
      `,
      {
        chat_id: chatId,
        purpose: kind === "direct" ? "chat" : "conversation",
      },
    );
    return rows.map(toSession);
  }

  /** The newest conversation message a session received, for the inbox of its next round. */
  public async delivered(sessionId: string): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT delivered_sequence
        FROM agent_conversations
        WHERE chat_session_id = $session_id;
      `,
      { session_id: sessionId },
    );
    return row ? readCountColumn(row, 0, "delivered_sequence") : 0;
  }

  /** Records that a session received the messages up to a sequence; the position only moves forward. */
  public async saveDelivered(
    sessionId: string,
    sequence: number,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_conversations
        SET delivered_sequence = GREATEST(delivered_sequence, $sequence)
        WHERE chat_session_id = $session_id;
      `,
      { session_id: sessionId, sequence },
    );
  }

  /** Records how full the context was after a round and what the round used. */
  public async recordUsage(
    sessionId: string,
    usage: AgentChatSessionUsage,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_conversations
        SET
            context_used = COALESCE($context_used, context_used),
            context_size = COALESCE($context_size, context_size),
            tokens_total = tokens_total + $tokens,
            tokens_today = CASE
                WHEN tokens_day = $day THEN tokens_today + $tokens
                ELSE $tokens
            END,
            tokens_day = $day,
            last_activity_at = $at
        WHERE chat_session_id = $session_id;
      `,
      {
        session_id: sessionId,
        context_used: usage.contextUsed,
        context_size: usage.contextSize,
        tokens: usage.tokens,
        day: usage.day,
        at: usage.at,
      },
    );
  }

  /** Marks the session as one that has to restart before it answers again, or clears the mark. */
  public async setNeedsRestart(
    sessionId: string,
    needsRestart: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_conversations
        SET needs_restart = $needs_restart
        WHERE chat_session_id = $session_id;
      `,
      { session_id: sessionId, needs_restart: needsRestart },
    );
  }

  /**
   * Records a restart: the next round starts a new process with the summary,
   * so the inbox begins anew and the context counts from zero.
   */
  public async markRestarted(sessionId: string, at: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_conversations
        SET
            needs_restart = FALSE,
            delivered_sequence = 0,
            context_used = NULL,
            restart_count = restart_count + 1,
            last_activity_at = $at
        WHERE chat_session_id = $session_id;
      `,
      { session_id: sessionId, at },
    );
  }

  /** The tokens all chat sessions of an agent used on one day. */
  public async tokensOn(agentId: string, day: string): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT COALESCE(SUM(tokens_today), 0)
        FROM agent_conversations
        WHERE agent_id = $agent_id
            AND purpose IN ('chat', 'conversation')
            AND tokens_day = $day;
      `,
      { agent_id: agentId, day },
    );
    return row ? readCountColumn(row, 0, "tokens_today") : 0;
  }

  /** Reads the settings of an agent; `null` for an unknown agent. */
  public async settings(
    agentId: string,
  ): Promise<StoredAgentChatSettings | null> {
    const [row] = await this.database.query(
      `
        SELECT
            chat_idle_minutes,
            chat_restart_percent
        FROM agent_employees
        WHERE user_id = $agent_id;
      `,
      { agent_id: agentId },
    );
    if (!row) return null;
    return {
      idleMinutes: readOptionalCount(row, 0, "chat_idle_minutes"),
      restartPercent: readCountColumn(row, 1, "chat_restart_percent"),
    };
  }

  /**
   * Saves the settings of an agent.
   *
   * @remarks
   * The revision of the agent stays, because a running session ends at its
   * next turn when the revision changes, and these settings change no
   * session.
   *
   * @returns Whether the agent exists.
   */
  public async saveSettings(
    agentId: string,
    settings: { readonly idleMinutes: number; readonly restartPercent: number },
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_employees
        SET
            chat_idle_minutes = $idle_minutes,
            chat_restart_percent = $restart_percent
        WHERE user_id = $agent_id
        RETURNING user_id;
      `,
      {
        agent_id: agentId,
        idle_minutes: settings.idleMinutes,
        restart_percent: settings.restartPercent,
      },
    );
    return rows.length > 0;
  }
}

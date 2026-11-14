import {
  readCountColumn,
  readIdListColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentLogbookKind,
  AgentLogbookOrigin,
  AgentLogbookSource,
} from "@/definition/AgentLogbook";

/** One entry of the Lagebuch as it is stored (PAGE-377). */
export interface StoredAgentLogbookEntry {
  readonly id: string;
  /** The insertion order; the ring buffer drops the lowest first. */
  readonly sequence: number;
  readonly agentId: string;
  readonly kind: AgentLogbookKind;
  readonly text: string;
  readonly topic: string;
  readonly source: AgentLogbookSource;
  readonly participants: readonly string[];
  readonly origin: AgentLogbookOrigin;
  /** ISO time the entry was written. */
  readonly createdAt: string;
}

/** An entry about to be written. */
export type NewAgentLogbookEntry = Omit<StoredAgentLogbookEntry, "sequence">;

/** How entries are looked up; every part narrows the result. */
export interface AgentLogbookFilter {
  /** Words that all appear in the text, topic, chat name or people of an entry. */
  readonly words: readonly string[];
  /** A part of the name of the chat, compared without regard to case; `null` for any chat. */
  readonly chat: string | null;
  readonly limit: number;
}

/** What is set per agent. */
export interface StoredAgentLogbookSettings {
  readonly limit: number;
  readonly quietMinutes: number;
  readonly connectionId: string | null;
  readonly model: string | null;
  /** ISO time the compaction was asked for last; `null` when never. */
  readonly compactionAt: string | null;
}

/** What an administrator saves per agent. */
export interface AgentLogbookSettingsChange {
  readonly limit: number;
  readonly quietMinutes: number;
  readonly model: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
}

/** What the hint line needs of the entries newer than a session's stand. */
export interface AgentLogbookNews {
  /** How many entries other chats wrote since the stand. */
  readonly count: number;
  /** The topics of the newest of them, the newest first. */
  readonly topics: readonly string[];
}

const COLUMNS = `
    agent_logbook_entries.id,
    agent_logbook_entries.sequence,
    agent_logbook_entries.agent_id,
    agent_logbook_entries.kind,
    agent_logbook_entries.text,
    agent_logbook_entries.topic,
    agent_logbook_entries.source_kind,
    agent_logbook_entries.source_id,
    agent_logbook_entries.source_name,
    agent_logbook_entries.participants,
    agent_logbook_entries.origin,
    agent_logbook_entries.created_at`;

/**
 * Leaves out the entries of a chat that is confidential now, whenever it was
 * marked: a chat marked after its entries were written disappears from every
 * read at once, so a confidential chat is never found through the Lagebuch.
 */
const NOT_CONFIDENTIAL = `
    NOT (
        (
            agent_logbook_entries.source_kind = 'direct'
            AND EXISTS (
                SELECT 1
                FROM agent_conversations
                WHERE agent_conversations.agent_id = agent_logbook_entries.agent_id
                    AND agent_conversations.person_id = agent_logbook_entries.source_id
                    AND agent_conversations.purpose = 'chat'
                    AND agent_conversations.is_confidential
            )
        )
        OR (
            agent_logbook_entries.source_kind = 'group'
            AND EXISTS (
                SELECT 1
                FROM conversations
                WHERE conversations.id = agent_logbook_entries.source_id
                    AND (
                        conversations.is_confidential
                        OR (
                            conversations.kind = 'direct'
                            AND EXISTS (
                                SELECT 1
                                FROM conversation_members
                                INNER JOIN agent_conversations
                                    ON agent_conversations.person_id = conversation_members.user_id
                                    AND agent_conversations.agent_id = agent_logbook_entries.agent_id
                                    AND agent_conversations.purpose = 'chat'
                                    AND agent_conversations.is_confidential
                                WHERE conversation_members.conversation_id = conversations.id
                                    AND conversation_members.user_id <> agent_logbook_entries.agent_id
                            )
                        )
                    )
            )
        )
    )`;

/** The longest search a call may use, in words. */
const MAXIMUM_WORDS = 6;

/** A `LIKE` pattern that finds the text as a part of another, with `%` and `_` taken literally. */
function containing(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/gu, "\\$&")}%`;
}

function toEntry(row: readonly DatabaseValue[]): StoredAgentLogbookEntry {
  return {
    id: readTextColumn(row, 0, "id"),
    sequence: readCountColumn(row, 1, "sequence"),
    agentId: readTextColumn(row, 2, "agent_id"),
    kind: readKind(readTextColumn(row, 3, "kind")),
    text: readTextColumn(row, 4, "text"),
    topic: readTextColumn(row, 5, "topic"),
    source: {
      kind:
        readTextColumn(row, 6, "source_kind") === "group" ? "group" : "direct",
      id: readTextColumn(row, 7, "source_id"),
      name: readTextColumn(row, 8, "source_name"),
    },
    participants: readIdListColumn(row, 9, "participants"),
    origin:
      readTextColumn(row, 10, "origin") === "agent" ? "agent" : "background",
    createdAt: readTextColumn(row, 11, "created_at"),
  };
}

function readKind(kind: string): AgentLogbookKind {
  switch (kind) {
    case "decision":
    case "open":
    case "fact":
    case "question":
      return kind;
    default:
      return "note";
  }
}

/**
 * The entries of the Lagebuch of agents and their settings (PAGE-377).
 *
 * @remarks
 * Every read leaves out the entries of confidential chats. The entries of an
 * agent form a ring buffer: {@link AgentLogbookRepository.trimToLimit} drops
 * the oldest past the limit.
 */
export class AgentLogbookRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Writes one entry. */
  public async append(entry: NewAgentLogbookEntry): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_logbook_entries (
            id,
            agent_id,
            kind,
            text,
            topic,
            source_kind,
            source_id,
            source_name,
            participants,
            origin,
            created_at
        )
        VALUES (
            $id,
            $agent_id,
            $kind,
            $text,
            $topic,
            $source_kind,
            $source_id,
            $source_name,
            $participants,
            $origin,
            $created_at
        );
      `,
      {
        id: entry.id,
        agent_id: entry.agentId,
        kind: entry.kind,
        text: entry.text,
        topic: entry.topic,
        source_kind: entry.source.kind,
        source_id: entry.source.id,
        source_name: entry.source.name,
        participants: JSON.stringify(entry.participants),
        origin: entry.origin,
        created_at: entry.createdAt,
      },
    );
  }

  /**
   * Drops the oldest entries of an agent beyond the limit.
   *
   * @returns How many entries dropped out.
   */
  public async trimToLimit(agentId: string, limit: number): Promise<number> {
    const rows = await this.database.query(
      `
        DELETE FROM agent_logbook_entries
        WHERE agent_id = $agent_id
            AND sequence <= COALESCE(
                (
                    SELECT sequence
                    FROM agent_logbook_entries
                    WHERE agent_id = $agent_id
                    ORDER BY sequence DESC
                    OFFSET $limit
                    LIMIT 1
                ),
                0
            )
        RETURNING id;
      `,
      { agent_id: agentId, limit },
    );
    return rows.length;
  }

  /** How many entries an agent's Lagebuch holds, those of confidential chats included. */
  public async count(agentId: string): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT COUNT(*)
        FROM agent_logbook_entries
        WHERE agent_id = $agent_id;
      `,
      { agent_id: agentId },
    );
    return row ? readCountColumn(row, 0, "count") : 0;
  }

  /** The sequence of the newest entry of an agent; `0` for an empty Lagebuch. */
  public async newestSequence(agentId: string): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT COALESCE(MAX(sequence), 0)
        FROM agent_logbook_entries
        WHERE agent_id = $agent_id;
      `,
      { agent_id: agentId },
    );
    return row ? readCountColumn(row, 0, "sequence") : 0;
  }

  /**
   * The entries of an agent that match the filter, the newest first.
   *
   * @remarks
   * Entries of confidential chats are never among them.
   */
  public async find(
    agentId: string,
    filter: AgentLogbookFilter,
  ): Promise<StoredAgentLogbookEntry[]> {
    const words = filter.words.slice(0, MAXIMUM_WORDS);
    const parameters: Record<string, string | number | null> = {
      agent_id: agentId,
      limit: filter.limit,
    };
    const conditions: string[] = [];
    words.forEach((word, index) => {
      parameters[`word_${String(index)}`] = containing(word);
      conditions.push(
        `lower(agent_logbook_entries.text || ' ' || agent_logbook_entries.topic || ' ' || agent_logbook_entries.source_name || ' ' || agent_logbook_entries.participants) LIKE $word_${String(index)} ESCAPE '\\'`,
      );
    });
    if (filter.chat !== null) {
      parameters.chat = containing(filter.chat);
      conditions.push(
        "lower(agent_logbook_entries.source_name) LIKE $chat ESCAPE '\\'",
      );
    }
    const extra = conditions
      .map((condition) => `AND ${condition}`)
      .join("\n            ");
    const rows = await this.database.query(
      `
        SELECT${COLUMNS}
        FROM agent_logbook_entries
        WHERE agent_logbook_entries.agent_id = $agent_id
            AND ${NOT_CONFIDENTIAL}
            ${extra}
        ORDER BY agent_logbook_entries.sequence DESC
        LIMIT $limit;
      `,
      parameters,
    );
    return rows.map(toEntry);
  }

  /**
   * The entries a dream run condenses (PAGE-378): those written after the
   * position of the last run, the oldest first. Of a backlog the oldest come
   * first, because they are the ones that fall out of the ring buffer next.
   *
   * @remarks
   * Entries of confidential chats are never among them.
   *
   * @param agentId - The agent.
   * @param window - The sequence after which entries are new and the most to return.
   */
  public async forDreaming(
    agentId: string,
    window: { readonly after: number; readonly limit: number },
  ): Promise<StoredAgentLogbookEntry[]> {
    const rows = await this.database.query(
      `
        SELECT${COLUMNS}
        FROM agent_logbook_entries
        WHERE agent_logbook_entries.agent_id = $agent_id
            AND ${NOT_CONFIDENTIAL}
            AND agent_logbook_entries.sequence > $after
        ORDER BY agent_logbook_entries.sequence
        LIMIT $limit;
      `,
      { agent_id: agentId, after: window.after, limit: window.limit },
    );
    return rows.map(toEntry);
  }

  /** The entries of one chat of an agent, the newest first. */
  public async ofChat(
    agentId: string,
    source: Pick<AgentLogbookSource, "kind" | "id">,
    limit: number,
  ): Promise<StoredAgentLogbookEntry[]> {
    const rows = await this.database.query(
      `
        SELECT${COLUMNS}
        FROM agent_logbook_entries
        WHERE agent_logbook_entries.agent_id = $agent_id
            AND agent_logbook_entries.source_kind = $source_kind
            AND agent_logbook_entries.source_id = $source_id
        ORDER BY agent_logbook_entries.sequence DESC
        LIMIT $limit;
      `,
      {
        agent_id: agentId,
        source_kind: source.kind,
        source_id: source.id,
        limit,
      },
    );
    return rows.map(toEntry);
  }

  /**
   * The names of the people of a chat: the person of a direct chat, the
   * members of a group without the agent.
   *
   * @param source - The chat.
   * @param agentId - The agent whose chat it is.
   */
  public async participantNames(
    source: Pick<AgentLogbookSource, "kind" | "id">,
    agentId: string,
  ): Promise<string[]> {
    const rows =
      source.kind === "direct"
        ? await this.database.query(
            `
              SELECT display_name
              FROM users
              WHERE id = $chat_id;
            `,
            { chat_id: source.id },
          )
        : await this.database.query(
            `
              SELECT users.display_name
              FROM conversation_members
              INNER JOIN users
                  ON users.id = conversation_members.user_id
              WHERE conversation_members.conversation_id = $chat_id
                  AND users.id <> $agent_id
              ORDER BY users.display_name;
            `,
            { chat_id: source.id, agent_id: agentId },
          );
    return rows.map((row) => readTextColumn(row, 0, "display_name"));
  }

  /** Reads entries by ID, leaving out those of other agents and unknown IDs. */
  public async byIds(
    agentId: string,
    ids: readonly string[],
  ): Promise<StoredAgentLogbookEntry[]> {
    if (ids.length === 0) return [];
    const parameters: Record<string, string | number | null> = {
      agent_id: agentId,
    };
    const placeholders = ids.map((id, index) => {
      parameters[`id_${String(index)}`] = id;
      return `$id_${String(index)}`;
    });
    const rows = await this.database.query(
      `
        SELECT${COLUMNS}
        FROM agent_logbook_entries
        WHERE agent_logbook_entries.agent_id = $agent_id
            AND agent_logbook_entries.id IN (${placeholders.join(", ")});
      `,
      parameters,
    );
    return rows.map(toEntry);
  }

  /**
   * What other chats wrote since a session's stand: how many entries and the
   * topics of the newest ones.
   *
   * @param agentId - The agent of the session.
   * @param stand - The newest sequence the session was told about.
   * @param own - The chat of the session, whose own entries do not count.
   * @param topics - How many topics to return.
   */
  public async newSince(
    agentId: string,
    stand: number,
    own: Pick<AgentLogbookSource, "kind" | "id">,
    topics: number,
  ): Promise<AgentLogbookNews> {
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*) OVER () AS total,
            agent_logbook_entries.topic
        FROM agent_logbook_entries
        WHERE agent_logbook_entries.agent_id = $agent_id
            AND agent_logbook_entries.sequence > $stand
            AND NOT (
                agent_logbook_entries.source_kind = $source_kind
                AND agent_logbook_entries.source_id = $source_id
            )
            AND ${NOT_CONFIDENTIAL}
        ORDER BY agent_logbook_entries.sequence DESC
        LIMIT $topics;
      `,
      {
        agent_id: agentId,
        stand,
        source_kind: own.kind,
        source_id: own.id,
        topics,
      },
    );
    const [first] = rows;
    return {
      count: first ? readCountColumn(first, 0, "total") : 0,
      topics: rows.map((row) => readTextColumn(row, 1, "topic")),
    };
  }

  /**
   * Removes entries of an agent by ID.
   *
   * @returns How many were removed.
   */
  public async remove(
    agentId: string,
    ids: readonly string[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const parameters: Record<string, string | number | null> = {
      agent_id: agentId,
    };
    const placeholders = ids.map((id, index) => {
      parameters[`id_${String(index)}`] = id;
      return `$id_${String(index)}`;
    });
    const rows = await this.database.query(
      `
        DELETE FROM agent_logbook_entries
        WHERE agent_id = $agent_id
            AND id IN (${placeholders.join(", ")})
        RETURNING id;
      `,
      parameters,
    );
    return rows.length;
  }

  /**
   * Removes every entry that came from one chat, of all agents; a chat that
   * becomes confidential leaves the Lagebuch this way.
   *
   * @param source - The chat; for a direct chat the person, with the agent whose chat it is.
   * @param agentId - Restricts the removal to one agent; a group concerns all its agents.
   */
  public async removeChat(
    source: Pick<AgentLogbookSource, "kind" | "id">,
    agentId: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_logbook_entries
        WHERE source_kind = $source_kind
            AND source_id = $source_id
            AND ($agent_id::text IS NULL OR agent_id = $agent_id::text);
      `,
      { source_kind: source.kind, source_id: source.id, agent_id: agentId },
    );
  }

  /** Reads the Lagebuch settings of an agent; `null` for an unknown agent. */
  public async settings(
    agentId: string,
  ): Promise<StoredAgentLogbookSettings | null> {
    const [row] = await this.database.query(
      `
        SELECT
            logbook_limit,
            logbook_quiet_minutes,
            logbook_connection_id,
            logbook_model,
            logbook_compaction_at
        FROM agent_employees
        WHERE user_id = $agent_id;
      `,
      { agent_id: agentId },
    );
    if (!row) return null;
    return {
      limit: readCountColumn(row, 0, "logbook_limit"),
      quietMinutes: readCountColumn(row, 1, "logbook_quiet_minutes"),
      connectionId: readNullableTextColumn(row, 2, "logbook_connection_id"),
      model: readNullableTextColumn(row, 3, "logbook_model"),
      compactionAt: readNullableTextColumn(row, 4, "logbook_compaction_at"),
    };
  }

  /**
   * Saves the settings of an agent.
   *
   * @remarks
   * The revision of the agent stays, because a running session ends at its
   * next turn when the revision changes, and these settings change no session.
   *
   * @returns Whether the agent exists.
   */
  public async saveSettings(
    agentId: string,
    change: AgentLogbookSettingsChange,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_employees
        SET
            logbook_limit = $limit,
            logbook_quiet_minutes = $quiet_minutes,
            logbook_connection_id = $connection_id,
            logbook_model = $model
        WHERE user_id = $agent_id
        RETURNING user_id;
      `,
      {
        agent_id: agentId,
        limit: change.limit,
        quiet_minutes: change.quietMinutes,
        connection_id: change.model?.connectionId ?? null,
        model: change.model?.model ?? null,
      },
    );
    return rows.length > 0;
  }

  /** Records when the compaction was asked for. */
  public async saveCompactionAt(agentId: string, at: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_employees
        SET logbook_compaction_at = $at
        WHERE user_id = $agent_id;
      `,
      { agent_id: agentId, at },
    );
  }
}

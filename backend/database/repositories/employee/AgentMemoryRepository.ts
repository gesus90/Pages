import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentArchiveEntry,
  AgentMemoryVersion,
  AgentMemoryVersionReason,
} from "@/definition/AgentEmployee";

/** A new archive entry with its counted words. */
export interface NewArchiveEntry {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  /** Creation time, `YYYY-MM-DD HH:MM:SS` UTC; the database clock without it. */
  readonly createdAt?: string;
}

/** A stored version with its full content, for restoring it. */
export interface StoredMemoryVersion extends AgentMemoryVersion {
  readonly memory: string;
  /** The archive entries of the version as JSON. */
  readonly archive: string;
}

/** What a new version records. */
export interface NewMemoryVersion {
  readonly id: string;
  readonly userId: string;
  readonly reason: AgentMemoryVersionReason;
  readonly memory: string;
  readonly archive: string;
  readonly coreWords: number;
  readonly archiveWords: number;
  readonly createdBy: string | null;
}

const REASONS: readonly AgentMemoryVersionReason[] = [
  "initial",
  "learning",
  "edit",
  "restore",
];

function readReason(input: string): AgentMemoryVersionReason {
  const reason = REASONS.find((entry) => entry === input);
  if (reason === undefined)
    throw new Error("Database returned an unsupported memory version reason.");
  return reason;
}

function readEntry(row: readonly DatabaseValue[]): AgentArchiveEntry {
  return {
    id: readTextColumn(row, 0, "id"),
    title: readTextColumn(row, 1, "title"),
    content: readTextColumn(row, 2, "content"),
    createdAt: readTextColumn(row, 3, "created_at"),
  };
}

function readVersion(row: readonly DatabaseValue[]): AgentMemoryVersion {
  return {
    id: readTextColumn(row, 0, "id"),
    reason: readReason(readTextColumn(row, 1, "reason")),
    createdAt: readTextColumn(row, 2, "created_at"),
    coreWords: readCountColumn(row, 3, "core_words"),
    archiveWords: readCountColumn(row, 4, "archive_words"),
  };
}

/**
 * The archive behind `MEMORY.md` and the restorable versions of both
 * (PAGE-266).
 *
 * @remarks
 * The archive is read as a whole only for an authorized view or a version;
 * a session searches it with {@link AgentMemoryRepository.search}.
 */
export class AgentMemoryRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns every archive entry of an agent, the newest first. */
  public async archive(userId: string): Promise<AgentArchiveEntry[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            title,
            content,
            created_at
        FROM agent_memory_archive
        WHERE user_id = $user_id
        ORDER BY created_at DESC, id;
      `,
      { user_id: userId },
    );
    return rows.map(readEntry);
  }

  /** Counts the words of an agent's archive. */
  public async archiveWords(userId: string): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT COALESCE(SUM(word_count), 0)
        FROM agent_memory_archive
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const row = rows[0];
    return row ? readCountColumn(row, 0, "word_count") : 0;
  }

  /**
   * Finds archive entries that contain every term, the best matches first.
   *
   * @param userId - The agent.
   * @param terms - Lower-case search terms, already limited by the caller.
   * @param limit - Entries to return at most.
   */
  public async search(
    userId: string,
    terms: readonly string[],
    limit: number,
  ): Promise<AgentArchiveEntry[]> {
    const parameters: Record<string, string | number> = {
      user_id: userId,
      limit,
    };
    // Only placeholders are interpolated; every term is bound as a value.
    const conditions = terms.map((term, index) => {
      parameters[`term_${index}`] = `%${term.replace(/[\\%_]/gu, "\\$&")}%`;
      return `lower(title || ' ' || content) LIKE $term_${index}`;
    });
    const rows = await this.database.query(
      `
        SELECT
            id,
            title,
            content,
            created_at
        FROM agent_memory_archive
        WHERE user_id = $user_id
            ${conditions.map((condition) => `AND ${condition}`).join("\n")}
        ORDER BY created_at DESC, id
        LIMIT $limit;
      `,
      parameters,
    );
    return rows.map(readEntry);
  }

  /** Adds entries to an agent's archive. */
  public async add(
    userId: string,
    entries: readonly NewArchiveEntry[],
  ): Promise<void> {
    for (const entry of entries)
      await this.database.execute(
        `
          INSERT INTO agent_memory_archive (
              id,
              user_id,
              title,
              content,
              word_count,
              created_at
          )
          VALUES (
              $id,
              $user_id,
              $title,
              $content,
              $word_count,
              COALESCE($created_at, utc_now())
          );
        `,
        {
          id: entry.id,
          user_id: userId,
          title: entry.title,
          content: entry.content,
          word_count: entry.wordCount,
          created_at: entry.createdAt ?? null,
        },
      );
  }

  /** Removes the named entries of an agent; IDs of other agents are ignored. */
  public async remove(userId: string, ids: readonly string[]): Promise<void> {
    for (const id of ids)
      await this.database.execute(
        `
          DELETE FROM agent_memory_archive
          WHERE user_id = $user_id
              AND id = $id;
        `,
        { user_id: userId, id },
      );
  }

  /** Removes every archive entry of an agent, before a version is restored. */
  public async clear(userId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_memory_archive
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
  }

  /**
   * Removes the oldest entries until the archive fits the word limit.
   *
   * @returns How many entries were removed.
   */
  public async trim(userId: string, maximumWords: number): Promise<number> {
    const rows = await this.database.query(
      `
        WITH ranked AS (
            SELECT
                id,
                SUM(word_count) OVER (
                    ORDER BY created_at DESC, id
                ) AS words_through
            FROM agent_memory_archive
            WHERE user_id = $user_id
        )
        DELETE FROM agent_memory_archive
        WHERE user_id = $user_id
            AND id IN (
                SELECT id
                FROM ranked
                WHERE words_through > $maximum_words
            )
        RETURNING id;
      `,
      { user_id: userId, maximum_words: maximumWords },
    );
    return rows.length;
  }

  /** Records a version of `MEMORY.md` and its archive. */
  public async addVersion(version: NewMemoryVersion): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_memory_versions (
            id,
            user_id,
            reason,
            memory,
            archive,
            core_words,
            archive_words,
            created_by
        )
        VALUES (
            $id,
            $user_id,
            $reason,
            $memory,
            $archive,
            $core_words,
            $archive_words,
            $created_by
        );
      `,
      {
        id: version.id,
        user_id: version.userId,
        reason: version.reason,
        memory: version.memory,
        archive: version.archive,
        core_words: version.coreWords,
        archive_words: version.archiveWords,
        created_by: version.createdBy,
      },
    );
  }

  /** Lists the versions of an agent, the newest first. */
  public async versions(
    userId: string,
    limit: number,
  ): Promise<AgentMemoryVersion[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            reason,
            created_at,
            core_words,
            archive_words
        FROM agent_memory_versions
        WHERE user_id = $user_id
        ORDER BY created_at DESC, id DESC
        LIMIT $limit;
      `,
      { user_id: userId, limit },
    );
    return rows.map(readVersion);
  }

  /** Returns one version of an agent with its content, or `null`. */
  public async findVersion(
    userId: string,
    id: string,
  ): Promise<StoredMemoryVersion | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            reason,
            created_at,
            core_words,
            archive_words,
            memory,
            archive
        FROM agent_memory_versions
        WHERE user_id = $user_id
            AND id = $id;
      `,
      { user_id: userId, id },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...readVersion(row),
      memory: readTextColumn(row, 5, "memory"),
      archive: readNullableTextColumn(row, 6, "archive") ?? "[]",
    };
  }

  /** Keeps the newest versions of an agent and removes older ones. */
  public async pruneVersions(userId: string, keep: number): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_memory_versions
        WHERE user_id = $user_id
            AND id NOT IN (
                SELECT id
                FROM agent_memory_versions
                WHERE user_id = $user_id
                ORDER BY created_at DESC, id DESC
                LIMIT $keep
            );
      `,
      { user_id: userId, keep },
    );
  }
}

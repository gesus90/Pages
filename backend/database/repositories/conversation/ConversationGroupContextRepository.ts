import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  ConversationGroupContextStatus,
  ConversationSummarySource,
} from "@/definition/ConversationObserver";

const CONTEXT_COLUMNS = `
    conversation_id,
    summary,
    decisions,
    open_items,
    responsibilities,
    sources,
    through_sequence,
    has_excerpts,
    status,
    error_code,
    revision,
    updated_at,
    attempted_at`;

/**
 * The fingerprint of the content messages of a group up to a sequence: their
 * IDs and texts in order. A message that changed or vanished changes it.
 */
const DIGEST_SELECT = `
    SELECT COALESCE(
        md5(string_agg(
            conversation_messages.id || ':' || md5(conversation_messages.text),
            ',' ORDER BY conversation_messages.sequence
        )),
        ''
    )
    FROM conversation_messages
    WHERE conversation_messages.conversation_id = $conversation_id
        AND conversation_messages.notice IS NULL
        AND conversation_messages.sequence <= $through_sequence`;

/** The same fingerprint up to the sequence a stored context reaches. */
const CURRENT_DIGEST_SELECT = `
    SELECT COALESCE(
        md5(string_agg(
            conversation_messages.id || ':' || md5(conversation_messages.text),
            ',' ORDER BY conversation_messages.sequence
        )),
        ''
    )
    FROM conversation_messages
    WHERE conversation_messages.conversation_id = conversation_group_contexts.conversation_id
        AND conversation_messages.notice IS NULL
        AND conversation_messages.sequence <= conversation_group_contexts.through_sequence`;

/** The stored context of a group. */
export interface StoredGroupContext {
  readonly conversationId: string;
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openItems: readonly string[];
  readonly responsibilities: readonly string[];
  readonly sources: readonly ConversationSummarySource[];
  readonly throughSequence: number;
  readonly hasExcerpts: boolean;
  readonly status: ConversationGroupContextStatus;
  readonly errorCode: string | null;
  readonly revision: number;
  readonly updatedAt: string | null;
  /** The last attempt, successful or not. */
  readonly attemptedAt: string | null;
}

/** A new summary of a group, built from one more window. */
export interface NewGroupSummary {
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openItems: readonly string[];
  readonly responsibilities: readonly string[];
  readonly sources: readonly ConversationSummarySource[];
  readonly throughSequence: number;
  readonly hasExcerpts: boolean;
  readonly status: Extract<
    ConversationGroupContextStatus,
    "current" | "behind"
  >;
  readonly updatedAt: string;
}

/** A group whose context waits for newer messages. */
export interface GroupContextCandidate {
  readonly conversationId: string;
  readonly throughSequence: number;
}

const STATUSES: readonly ConversationGroupContextStatus[] = [
  "current",
  "behind",
  "unavailable",
  "rebuilding",
];

function readList(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isSource(value: unknown): value is ConversationSummarySource {
  if (typeof value !== "object" || value === null) return false;
  return (
    "fromSequence" in value &&
    typeof value.fromSequence === "number" &&
    "toSequence" in value &&
    typeof value.toSequence === "number" &&
    "messageIds" in value &&
    Array.isArray(value.messageIds)
  );
}

function readSources(text: string): ConversationSummarySource[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed.filter(isSource) : [];
}

function toContext(row: readonly DatabaseValue[]): StoredGroupContext {
  const status = readTextColumn(row, 8, "status");
  return {
    conversationId: readTextColumn(row, 0, "conversation_id"),
    summary: readTextColumn(row, 1, "summary"),
    decisions: readList(readTextColumn(row, 2, "decisions")),
    openItems: readList(readTextColumn(row, 3, "open_items")),
    responsibilities: readList(readTextColumn(row, 4, "responsibilities")),
    sources: readSources(readTextColumn(row, 5, "sources")),
    throughSequence: readCountColumn(row, 6, "through_sequence"),
    hasExcerpts: readBooleanColumn(row, 7, "has_excerpts"),
    status: STATUSES.find((known) => known === status) ?? "unavailable",
    errorCode: readNullableTextColumn(row, 9, "error_code"),
    revision: readCountColumn(row, 10, "revision"),
    updatedAt: readNullableTextColumn(row, 11, "updated_at"),
    attemptedAt: readNullableTextColumn(row, 12, "attempted_at"),
  };
}

/**
 * The stored context of each group (PAGE-296): summary, decisions, open
 * points, responsibilities, their sources and how far they reach.
 *
 * @remarks
 * The context is private data of its group and goes with it. A summary
 * saves only against the revision it was built on, so two processes never
 * overwrite each other, and the sequence it reaches never moves past a
 * message it did not read.
 */
export class ConversationGroupContextRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the stored context of a group, or `null` before the first. */
  public async find(
    conversationId: string,
  ): Promise<StoredGroupContext | null> {
    const rows = await this.database.query(
      `
        SELECT${CONTEXT_COLUMNS}
        FROM conversation_group_contexts
        WHERE conversation_id = $conversation_id;
      `,
      { conversation_id: conversationId },
    );
    const [row] = rows;
    return row ? toContext(row) : null;
  }

  /**
   * Saves a summary built on the given revision, with the fingerprint of the
   * messages it now contains.
   *
   * @returns `false` when the stored context changed meanwhile.
   */
  public async saveSummary(
    conversationId: string,
    summary: NewGroupSummary,
    expectedRevision: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        INSERT INTO conversation_group_contexts (
            conversation_id,
            summary,
            decisions,
            open_items,
            responsibilities,
            sources,
            through_sequence,
            source_digest,
            has_excerpts,
            status,
            error_code,
            revision,
            updated_at,
            attempted_at
        )
        VALUES (
            $conversation_id,
            $summary,
            $decisions,
            $open_items,
            $responsibilities,
            $sources,
            $through_sequence,
            (${DIGEST_SELECT}),
            $has_excerpts,
            $status,
            NULL,
            1,
            $updated_at,
            $updated_at
        )
        ON CONFLICT (conversation_id) DO UPDATE
        SET
            summary = EXCLUDED.summary,
            decisions = EXCLUDED.decisions,
            open_items = EXCLUDED.open_items,
            responsibilities = EXCLUDED.responsibilities,
            sources = EXCLUDED.sources,
            through_sequence = EXCLUDED.through_sequence,
            source_digest = EXCLUDED.source_digest,
            has_excerpts = EXCLUDED.has_excerpts,
            status = EXCLUDED.status,
            error_code = NULL,
            revision = conversation_group_contexts.revision + 1,
            updated_at = EXCLUDED.updated_at,
            attempted_at = EXCLUDED.attempted_at
        WHERE conversation_group_contexts.revision = $expected_revision
        RETURNING conversation_id;
      `,
      {
        conversation_id: conversationId,
        summary: summary.summary,
        decisions: JSON.stringify(summary.decisions),
        open_items: JSON.stringify(summary.openItems),
        responsibilities: JSON.stringify(summary.responsibilities),
        sources: JSON.stringify(summary.sources),
        through_sequence: summary.throughSequence,
        has_excerpts: summary.hasExcerpts,
        status: summary.status,
        updated_at: summary.updatedAt,
        expected_revision: expectedRevision,
      },
    );
    return rows.length > 0;
  }

  /**
   * Records an attempt that produced no summary: the stored summary stays,
   * and the status and code tell why nothing newer exists.
   */
  public async recordFailure(
    conversationId: string,
    failure: {
      readonly status: Extract<
        ConversationGroupContextStatus,
        "behind" | "unavailable" | "rebuilding"
      >;
      readonly errorCode: string;
      readonly attemptedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_group_contexts (
            conversation_id,
            status,
            error_code,
            attempted_at
        )
        VALUES (
            $conversation_id,
            $status,
            $error_code,
            $attempted_at
        )
        ON CONFLICT (conversation_id) DO UPDATE
        SET
            status = EXCLUDED.status,
            error_code = EXCLUDED.error_code,
            attempted_at = EXCLUDED.attempted_at;
      `,
      {
        conversation_id: conversationId,
        status: failure.status,
        error_code: failure.errorCode,
        attempted_at: failure.attemptedAt,
      },
    );
  }

  /**
   * Drops the summary of a group after a summarized message changed or
   * vanished; it is built anew from the messages that remain, and nothing of
   * the removed content survives in the stored context.
   */
  public async invalidate(conversationId: string, at: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversation_group_contexts
        SET
            summary = '',
            decisions = '[]',
            open_items = '[]',
            responsibilities = '[]',
            sources = '[]',
            through_sequence = 0,
            source_digest = '',
            has_excerpts = FALSE,
            status = 'rebuilding',
            error_code = 'source_changed',
            revision = revision + 1,
            updated_at = NULL,
            attempted_at = $at
        WHERE conversation_id = $conversation_id;
      `,
      { conversation_id: conversationId, at },
    );
  }

  /**
   * Returns the groups whose context has unread content messages: groups
   * with an active agent member only, the most recently active first.
   */
  public async candidates(limit: number): Promise<GroupContextCandidate[]> {
    const rows = await this.database.query(
      `
        SELECT
            conversations.id,
            COALESCE(conversation_group_contexts.through_sequence, 0) AS through_sequence
        FROM conversations
        LEFT JOIN conversation_group_contexts
            ON conversation_group_contexts.conversation_id = conversations.id
        WHERE conversations.kind = 'group'
            AND EXISTS (
                SELECT 1
                FROM conversation_members
                INNER JOIN users
                    ON users.id = conversation_members.user_id
                WHERE conversation_members.conversation_id = conversations.id
                    AND users.account_kind = 'agent'
                    AND users.is_active = 1
            )
            AND EXISTS (
                SELECT 1
                FROM conversation_messages
                WHERE conversation_messages.conversation_id = conversations.id
                    AND conversation_messages.notice IS NULL
                    AND conversation_messages.sequence > COALESCE(conversation_group_contexts.through_sequence, 0)
            )
        ORDER BY conversations.last_activity_at DESC
        LIMIT $limit;
      `,
      { limit },
    );
    return rows.map((row) => ({
      conversationId: readTextColumn(row, 0, "id"),
      throughSequence: readCountColumn(row, 1, "through_sequence"),
    }));
  }

  /** Returns the groups whose summarized messages no longer match their fingerprint. */
  public async changedSources(): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT conversation_group_contexts.conversation_id
        FROM conversation_group_contexts
        WHERE conversation_group_contexts.through_sequence > 0
            AND conversation_group_contexts.source_digest <> (${CURRENT_DIGEST_SELECT});
      `,
    );
    return rows.map((row) => readTextColumn(row, 0, "conversation_id"));
  }

  /**
   * Whether the summarized messages of a group still match the fingerprint
   * of its summary; a group without a summary matches.
   */
  public async isSourceCurrent(conversationId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT conversation_group_contexts.conversation_id
        FROM conversation_group_contexts
        WHERE conversation_group_contexts.conversation_id = $conversation_id
            AND conversation_group_contexts.through_sequence > 0
            AND conversation_group_contexts.source_digest <> (${CURRENT_DIGEST_SELECT});
      `,
      { conversation_id: conversationId },
    );
    return rows.length === 0;
  }

  /** Counts the content messages of a group after a sequence. */
  public async pendingCount(
    conversationId: string,
    afterSequence: number,
  ): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT COUNT(*)
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND notice IS NULL
            AND sequence > $after_sequence;
      `,
      { conversation_id: conversationId, after_sequence: afterSequence },
    );
    const [row] = rows;
    return row ? readCountColumn(row, 0, "count") : 0;
  }
}

import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { createVisiblePagesQuery } from "./WikiVisibility";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiFeedReason, WikiVisibilityScope } from "@/definition/Wiki";

/** An entry of "For me" before it is marked as read or unread. */
export interface RawWikiFeedItem {
  readonly reason: WikiFeedReason;
  readonly pageId: string;
  readonly pageTitle: string;
  readonly excerpt: string;
  readonly actorName: string;
  readonly at: string;
}

/** The earliest read time, so that a first visit shows everything as new. */
const NEVER_READ = "1970-01-01 00:00:00";

/** People who mentioned the viewer. */
const MENTIONS = `
    SELECT
        'mention' AS reason,
        page.id AS page_id,
        page.title AS page_title,
        COALESCE(comment.body, '') AS excerpt,
        COALESCE(actor.display_name, '') AS actor_name,
        mention.created_at AS at
    FROM wiki_mentions AS mention
    INNER JOIN wiki_pages AS page
        ON page.id = mention.page_id
    INNER JOIN visible_pages
        ON visible_pages.id = page.id
    LEFT JOIN wiki_comments AS comment
        ON comment.id = mention.comment_id
    LEFT JOIN users AS actor
        ON actor.id = mention.created_by
    WHERE mention.user_id = $viewer_id
        AND mention.created_by <> $viewer_id
`;

/** Replies to comments of the viewer. */
const REPLIES = `
    SELECT
        'reply',
        page.id,
        page.title,
        reply.body,
        COALESCE(actor.display_name, ''),
        reply.created_at
    FROM wiki_comments AS reply
    INNER JOIN wiki_comments AS parent
        ON parent.id = reply.parent_id
    INNER JOIN wiki_pages AS page
        ON page.id = reply.page_id
    INNER JOIN visible_pages
        ON visible_pages.id = page.id
    LEFT JOIN users AS actor
        ON actor.id = reply.author_id
    WHERE parent.author_id = $viewer_id
        AND reply.author_id <> $viewer_id
`;

/** Other comments on pages of the viewer, without those listed above. */
const COMMENTS = `
    SELECT
        'comment',
        page.id,
        page.title,
        comment.body,
        COALESCE(actor.display_name, ''),
        comment.created_at
    FROM wiki_comments AS comment
    INNER JOIN wiki_pages AS page
        ON page.id = comment.page_id
    INNER JOIN visible_pages
        ON visible_pages.id = page.id
    LEFT JOIN users AS actor
        ON actor.id = comment.author_id
    WHERE page.owner_id = $viewer_id
        AND comment.author_id <> $viewer_id
        AND NOT EXISTS (
            SELECT 1
            FROM wiki_comments AS parent
            WHERE parent.id = comment.parent_id
                AND parent.author_id = $viewer_id
        )
        AND NOT EXISTS (
            SELECT 1
            FROM wiki_mentions AS mention
            WHERE mention.comment_id = comment.id
                AND mention.user_id = $viewer_id
        )
`;

/** Pages of the viewer that are no longer current. */
const EXPIRED = `
    SELECT
        'expired',
        page.id,
        page.title,
        '',
        '',
        page.current_until || ' 00:00:00'
    FROM wiki_pages AS page
    INNER JOIN visible_pages
        ON visible_pages.id = page.id
    WHERE page.owner_id = $viewer_id
        AND page.is_template = 0
        AND page.current_until IS NOT NULL
        AND page.current_until < $today
`;

/** Owns the queries behind "For me" and the read time of each person. */
export class WikiFeedRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Collects what concerns a person: mentions, replies to their comments,
   * comments on their pages and their pages that are no longer current.
   *
   * @param scope - What the person may see; every entry comes from a visible
   * page, so nothing about a hidden page can appear.
   * @param today - Today as `YYYY-MM-DD`.
   * @returns The newest 100 entries, newest first.
   */
  public async collect(
    scope: WikiVisibilityScope,
    today: string,
  ): Promise<RawWikiFeedItem[]> {
    const visible = createVisiblePagesQuery(scope);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT
            entries.reason,
            entries.page_id,
            entries.page_title,
            entries.excerpt,
            entries.actor_name,
            entries.at
        FROM (
            ${MENTIONS}
            UNION ALL
            ${REPLIES}
            UNION ALL
            ${COMMENTS}
            UNION ALL
            ${EXPIRED}
        ) AS entries
        ORDER BY entries.at DESC, entries.page_id
        LIMIT 100;
      `,
      { ...visible.parameters, today },
    );

    return rows.map((row) => ({
      actorName: readTextColumn(row, 4, "actor_name"),
      at: readTextColumn(row, 5, "at"),
      excerpt: readTextColumn(row, 3, "excerpt"),
      pageId: readTextColumn(row, 1, "page_id"),
      pageTitle: readTextColumn(row, 2, "page_title"),
      reason: readReason(readTextColumn(row, 0, "reason")),
    }));
  }

  /**
   * Reads when a person last marked "For me" as read.
   *
   * @param userId - Account identifier.
   * @returns The time; a date long ago if they never did.
   */
  public async findReadTime(userId: string): Promise<string> {
    const [row = []] = await this.database.query(
      "SELECT feed_read_at FROM wiki_user_state WHERE user_id = $user_id;",
      { user_id: userId },
    );

    return readNullableTextColumn(row, 0, "feed_read_at") ?? NEVER_READ;
  }

  /**
   * Marks everything up to now as read.
   *
   * @param userId - Account identifier.
   */
  public async markRead(userId: string): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO wiki_user_state (
            user_id
        )
        VALUES (
            $user_id
        )
        ON CONFLICT (user_id) DO UPDATE SET
            feed_read_at = utc_now();
      `,
      { user_id: userId },
    );
  }
}

function readReason(reason: string): WikiFeedReason {
  if (reason === "mention" || reason === "reply" || reason === "comment") {
    return reason;
  }

  return "expired";
}

import { randomUUID } from "node:crypto";

import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** Values of a comment that is stored. */
export interface NewWikiComment {
  readonly pageId: string;
  /** The comment this one answers; `null` for a first comment. */
  readonly parentId: string | null;
  readonly authorId: string;
  readonly body: string;
  /** The passage a comment on the text refers to. */
  readonly quote: string | null;
  readonly quotePrefix: string | null;
  readonly quoteSuffix: string | null;
}

/** A comment as stored, with the names of the people involved. */
export interface StoredWikiComment extends NewWikiComment {
  readonly id: string;
  readonly authorName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedByName: string | null;
}

const COLUMNS = `
    comment.id,
    comment.page_id,
    comment.parent_id,
    comment.author_id,
    author.display_name,
    comment.body,
    comment.quote,
    comment.quote_prefix,
    comment.quote_suffix,
    comment.created_at,
    comment.updated_at,
    comment.resolved_at,
    resolver.display_name
`;

const JOINS = `
    LEFT JOIN users AS author
        ON author.id = comment.author_id
    LEFT JOIN users AS resolver
        ON resolver.id = comment.resolved_by
`;

function readComment(row: readonly DatabaseValue[]): StoredWikiComment {
  return {
    authorId: readTextColumn(row, 3, "author_id"),
    authorName: readNullableTextColumn(row, 4, "author_name") ?? "",
    body: readTextColumn(row, 5, "body"),
    createdAt: readTextColumn(row, 9, "created_at"),
    id: readTextColumn(row, 0, "id"),
    pageId: readTextColumn(row, 1, "page_id"),
    parentId: readNullableTextColumn(row, 2, "parent_id"),
    quote: readNullableTextColumn(row, 6, "quote"),
    quotePrefix: readNullableTextColumn(row, 7, "quote_prefix"),
    quoteSuffix: readNullableTextColumn(row, 8, "quote_suffix"),
    resolvedAt: readNullableTextColumn(row, 11, "resolved_at"),
    resolvedByName: readNullableTextColumn(row, 12, "resolved_by_name"),
    updatedAt: readTextColumn(row, 10, "updated_at"),
  };
}

/** Owns persistence of the comments below pages. */
export class WikiCommentRepository {
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
   * Stores a comment.
   *
   * @param comment - Validated values.
   * @returns The identifier of the comment.
   */
  public async insert(comment: NewWikiComment): Promise<string> {
    const id = randomUUID();

    await this.database.execute(
      `
        INSERT INTO wiki_comments (
            id,
            page_id,
            parent_id,
            author_id,
            body,
            quote,
            quote_prefix,
            quote_suffix
        )
        VALUES (
            $id,
            $page_id,
            $parent_id,
            $author_id,
            $body,
            $quote,
            $quote_prefix,
            $quote_suffix
        );
      `,
      {
        author_id: comment.authorId,
        body: comment.body,
        id,
        page_id: comment.pageId,
        parent_id: comment.parentId,
        quote: comment.quote,
        quote_prefix: comment.quotePrefix,
        quote_suffix: comment.quoteSuffix,
      },
    );

    return id;
  }

  /**
   * Lists the comments of a page, oldest first.
   *
   * @param pageId - Page identifier.
   * @returns First comments and replies together.
   */
  public async listByPage(pageId: string): Promise<StoredWikiComment[]> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM wiki_comments AS comment
        ${JOINS}
        WHERE comment.page_id = $page_id
        ORDER BY comment.created_at, comment.rowid;
      `,
      { page_id: pageId },
    );

    return rows.map(readComment);
  }

  /**
   * Reads one comment.
   *
   * @param id - Comment identifier.
   * @returns The comment, or `null`.
   */
  public async find(id: string): Promise<StoredWikiComment | null> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM wiki_comments AS comment
        ${JOINS}
        WHERE comment.id = $id;
      `,
      { id },
    );
    const [row] = rows;

    return row ? readComment(row) : null;
  }

  /**
   * Changes the text of a comment.
   *
   * @param id - Comment identifier.
   * @param body - The new text.
   */
  public async updateBody(id: string, body: string): Promise<void> {
    await this.database.execute(
      "UPDATE wiki_comments SET body = $body, updated_at = utc_now() WHERE id = $id;",
      { body, id },
    );
  }

  /**
   * Marks a comment as resolved, or opens it again.
   *
   * @param id - Comment identifier.
   * @param resolvedBy - Account that resolves it; `null` reopens it.
   */
  public async setResolved(
    id: string,
    resolvedBy: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE wiki_comments
        SET
            resolved_at = CASE WHEN $resolved_by IS NULL THEN NULL ELSE utc_now() END,
            resolved_by = $resolved_by
        WHERE id = $id;
      `,
      { id, resolved_by: resolvedBy },
    );
  }

  /**
   * Deletes a comment with its replies and mentions.
   *
   * @param id - Comment identifier.
   */
  public async delete(id: string): Promise<void> {
    const thread =
      "SELECT id FROM wiki_comments WHERE id = $id OR parent_id = $id";

    await this.database.execute(
      `DELETE FROM wiki_mentions WHERE comment_id IN (${thread});`,
      { id },
    );
    await this.database.execute(
      `DELETE FROM wiki_comments WHERE id IN (${thread});`,
      { id },
    );
  }
}

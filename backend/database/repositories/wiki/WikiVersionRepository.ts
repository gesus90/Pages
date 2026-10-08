import { randomUUID } from "node:crypto";

import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { readCount } from "./WikiPageRows";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** A stored version of a page. */
export interface WikiVersionSummary {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A stored version with its text. */
export interface WikiVersion extends WikiVersionSummary {
  readonly content: string;
}

/** Values of a version that is stored. */
export interface NewWikiVersion {
  readonly pageId: string;
  readonly revision: number;
  readonly title: string;
  readonly content: string;
  readonly authorId: string;
}

/** Owns persistence of page versions. */
export class WikiVersionRepository {
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
   * Adds a version, or refreshes the newest one.
   *
   * @param version - The saved state of the page.
   * @param coalesceMinutes - A newest version by the same author younger
   * than this many minutes is updated instead of adding a new one. Zero
   * always adds.
   */
  public async save(
    version: NewWikiVersion,
    coalesceMinutes: number,
  ): Promise<void> {
    const refreshableId =
      coalesceMinutes > 0
        ? await this.findRefreshableId(version, coalesceMinutes)
        : null;

    if (refreshableId !== null) {
      await this.database.execute(
        `
          UPDATE wiki_page_versions
          SET
              revision = $revision,
              title = $title,
              content = $content,
              updated_at = utc_now()
          WHERE id = $id;
        `,
        {
          content: version.content,
          id: refreshableId,
          revision: version.revision,
          title: version.title,
        },
      );

      return;
    }

    await this.database.execute(
      `
        INSERT INTO wiki_page_versions (
            id,
            page_id,
            revision,
            title,
            content,
            author_id
        )
        VALUES (
            $id,
            $page_id,
            $revision,
            $title,
            $content,
            $author_id
        );
      `,
      {
        author_id: version.authorId,
        content: version.content,
        id: randomUUID(),
        page_id: version.pageId,
        revision: version.revision,
        title: version.title,
      },
    );
  }

  /**
   * Lists the versions of a page, newest first.
   *
   * @param pageId - Page identifier.
   * @returns The versions without their text.
   */
  public async list(pageId: string): Promise<WikiVersionSummary[]> {
    const rows = await this.database.query(
      `
        SELECT
            version.id,
            version.revision,
            version.title,
            version.author_id,
            author.display_name,
            version.created_at,
            version.updated_at
        FROM wiki_page_versions AS version
        LEFT JOIN users AS author
            ON author.id = version.author_id
        WHERE version.page_id = $page_id
        ORDER BY version.revision DESC, version.created_at DESC;
      `,
      { page_id: pageId },
    );

    return rows.map((row) => ({
      authorId: readTextColumn(row, 3, "author_id"),
      authorName: readNullableTextColumn(row, 4, "author_name") ?? "",
      createdAt: readTextColumn(row, 5, "created_at"),
      id: readTextColumn(row, 0, "id"),
      revision: readCount(row, 1, "revision"),
      title: readTextColumn(row, 2, "title"),
      updatedAt: readTextColumn(row, 6, "updated_at"),
    }));
  }

  /**
   * Reads one version of a page.
   *
   * @param pageId - Page identifier.
   * @param versionId - Version identifier.
   * @returns The version with its text, or `null`.
   */
  public async find(
    pageId: string,
    versionId: string,
  ): Promise<WikiVersion | null> {
    const rows = await this.database.query(
      `
        SELECT
            version.id,
            version.revision,
            version.title,
            version.author_id,
            author.display_name,
            version.created_at,
            version.updated_at,
            version.content
        FROM wiki_page_versions AS version
        LEFT JOIN users AS author
            ON author.id = version.author_id
        WHERE version.page_id = $page_id
            AND version.id = $version_id;
      `,
      { page_id: pageId, version_id: versionId },
    );
    const row = rows[0];

    return row
      ? {
          authorId: readTextColumn(row, 3, "author_id"),
          authorName: readNullableTextColumn(row, 4, "author_name") ?? "",
          content: readTextColumn(row, 7, "content"),
          createdAt: readTextColumn(row, 5, "created_at"),
          id: readTextColumn(row, 0, "id"),
          revision: readCount(row, 1, "revision"),
          title: readTextColumn(row, 2, "title"),
          updatedAt: readTextColumn(row, 6, "updated_at"),
        }
      : null;
  }

  /**
   * Removes versions beyond the retention rules.
   *
   * @param retentionDays - Versions younger than this many days stay.
   * @param keepLast - The newest versions of each page stay as well.
   *
   * @remarks
   * A version stays when it is young enough or among the newest `keepLast`
   * of its page, whichever keeps more.
   */
  public async prune(retentionDays: number, keepLast: number): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM wiki_page_versions
        WHERE id IN (
            SELECT ranked.id
            FROM (
                SELECT
                    version.id,
                    version.created_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY version.page_id
                        ORDER BY version.revision DESC, version.created_at DESC
                    ) AS recency
                FROM wiki_page_versions AS version
            ) AS ranked
            WHERE ranked.recency > $keep_last
                AND ranked.created_at < utc_after(
                    to_days(CAST(-$retention_days AS INTEGER))
                )
        );
      `,
      { keep_last: keepLast, retention_days: retentionDays },
    );
  }

  private async findRefreshableId(
    version: NewWikiVersion,
    coalesceMinutes: number,
  ): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT id
        FROM wiki_page_versions
        WHERE page_id = $page_id
            AND author_id = $author_id
            AND created_at >= utc_after(to_minutes(CAST(-$minutes AS INTEGER)))
            AND revision = (
                SELECT MAX(revision)
                FROM wiki_page_versions
                WHERE page_id = $page_id
            );
      `,
      {
        author_id: version.authorId,
        minutes: coalesceMinutes,
        page_id: version.pageId,
      },
    );
    const row = rows[0];

    return row ? readTextColumn(row, 0, "id") : null;
  }
}

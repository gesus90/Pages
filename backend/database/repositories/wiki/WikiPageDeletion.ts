import { readTextColumn } from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";

/** A selection of pages, as a query that returns their identifiers. */
export interface WikiPageSelection {
  /** Trusted SQL returning one `id` column of `wiki_pages`. */
  readonly sql: string;
  readonly parameters: SqlParameters;
}

/** Tables whose rows belong to exactly one page. */
const PAGE_OWNED_TABLES = [
  "wiki_page_anchors",
  "wiki_page_versions",
  "wiki_page_links",
  "wiki_attachments",
  "wiki_comments",
  "wiki_mentions",
  "wiki_favorites",
  "wiki_recent_pages",
  "wiki_expanded_pages",
] as const;

/**
 * Deletes pages for good, together with everything that belongs to them.
 *
 * @param database - The transaction to delete in.
 * @param selection - The pages to delete.
 * @returns Storage names of the attachment files that no longer have a row;
 * the caller removes them from the disk after the transaction committed.
 */
export async function deleteWikiPages(
  database: DatabaseTransaction,
  selection: WikiPageSelection,
): Promise<string[]> {
  const files = await database.query(
    `
      SELECT storage_name
      FROM wiki_attachments
      WHERE page_id IN (${selection.sql});
    `,
    selection.parameters,
  );

  for (const table of PAGE_OWNED_TABLES) {
    await database.execute(
      `DELETE FROM ${table} WHERE page_id IN (${selection.sql});`,
      selection.parameters,
    );
  }

  await database.execute(
    `
      DELETE FROM wiki_page_links
      WHERE target_kind = 'page'
          AND target_id IN (${selection.sql});
    `,
    selection.parameters,
  );
  await database.execute(
    `DELETE FROM wiki_pages WHERE id IN (${selection.sql});`,
    selection.parameters,
  );

  return files.map((row) => readTextColumn(row, 0, "storage_name"));
}

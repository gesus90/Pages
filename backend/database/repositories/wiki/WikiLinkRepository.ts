import { createWorkItemVisibility } from "@/backend/database/repositories/task/WorkItemVisibility";
import { readTextColumn } from "@/backend/database/RowValue";

import {
  readSummary,
  WIKI_PAGE_JOINS,
  WIKI_SUMMARY_COLUMNS,
} from "./WikiPageRows";
import { createInCondition, createVisiblePagesQuery } from "./WikiVisibility";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiPageSummary, WikiVisibilityScope } from "@/definition/Wiki";

/** A ticket whose description may link to a page. */
export interface WikiTicketSource {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string;
}

/** A project whose description may link to a page. */
export interface WikiProjectSource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** Owns persistence of the links between pages and to tickets. */
export class WikiLinkRepository {
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
   * Replaces the links a page contains.
   *
   * @param pageId - Page identifier.
   * @param targets - The pages and tickets the text links to.
   */
  public async replace(
    pageId: string,
    targets: {
      readonly pageIds: readonly string[];
      readonly ticketKeys: readonly string[];
    },
  ): Promise<void> {
    await this.database.execute(
      "DELETE FROM wiki_page_links WHERE page_id = $page_id;",
      { page_id: pageId },
    );

    const links = [
      ...targets.pageIds
        .filter((id) => id !== pageId)
        .map((id) => ({ id, kind: "page" })),
      ...targets.ticketKeys.map((id) => ({ id, kind: "ticket" })),
    ];

    for (const link of links) {
      await this.database.execute(
        `
          INSERT INTO wiki_page_links (
              page_id,
              target_kind,
              target_id
          )
          VALUES (
              $page_id,
              $target_kind,
              $target_id
          );
        `,
        { page_id: pageId, target_id: link.id, target_kind: link.kind },
      );
    }
  }

  /**
   * Lists the visible pages that link to a page.
   *
   * @param scope - What the viewer may see.
   * @param pageId - The linked page.
   * @returns Visible pages by title; pages the viewer cannot see do not
   * appear at all.
   */
  public async findLinkingPages(
    scope: WikiVisibilityScope,
    pageId: string,
  ): Promise<WikiPageSummary[]> {
    const visible = createVisiblePagesQuery(scope);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT ${WIKI_SUMMARY_COLUMNS}
        FROM wiki_page_links AS link
        INNER JOIN wiki_pages AS page
            ON page.id = link.page_id
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        ${WIKI_PAGE_JOINS}
        WHERE link.target_kind = 'page'
            AND link.target_id = $target_id
            AND page.is_template = 0
        ORDER BY page.title, page.id;
      `,
      { ...visible.parameters, target_id: pageId },
    );

    return rows.map(readSummary);
  }

  /**
   * Lists the visible tickets whose description mentions an address.
   *
   * @param scope - What the viewer may see.
   * @param needle - Text to look for, such as `/wiki/<id>`.
   * @returns Tickets that mention the text; the caller checks the boundary.
   */
  public async findTicketsMentioning(
    scope: WikiVisibilityScope,
    needle: string,
  ): Promise<WikiTicketSource[]> {
    const visibility = createTicketVisibility(scope);
    const rows = await this.database.query(
      `
        SELECT
            work_items.id,
            work_items.title,
            work_items.key,
            work_items.description
        FROM work_items
        WHERE work_items.description LIKE $needle ESCAPE '\\'
            AND ${visibility.condition}
        ORDER BY work_items.key;
      `,
      { ...visibility.parameters, needle: `%${escapeLike(needle)}%` },
    );

    return rows.map((row) => ({
      description: readTextColumn(row, 3, "description"),
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 2, "key"),
      title: readTextColumn(row, 1, "title"),
    }));
  }

  /**
   * Lists the readable projects whose description mentions an address.
   *
   * @param scope - What the viewer may see.
   * @param needle - Text to look for, such as `/wiki/<id>`.
   * @returns Projects that mention the text.
   */
  public async findProjectsMentioning(
    scope: WikiVisibilityScope,
    needle: string,
  ): Promise<WikiProjectSource[]> {
    const projects = createInCondition(
      "project.id",
      "project",
      scope.projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            project.id,
            project.name,
            project.description
        FROM projects AS project
        WHERE project.description LIKE $needle ESCAPE '\\'
            AND ${projects.sql}
        ORDER BY project.name;
      `,
      { ...projects.parameters, needle: `%${escapeLike(needle)}%` },
    );

    return rows.map((row) => ({
      description: readTextColumn(row, 2, "description"),
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
    }));
  }

  /**
   * Finds visible tickets by key or title, for the reference picker.
   *
   * @param scope - What the viewer may see.
   * @param query - Text typed after the trigger.
   * @param limit - Largest number of tickets.
   * @returns Tickets by key.
   */
  public async searchTickets(
    scope: WikiVisibilityScope,
    query: string,
    limit: number,
  ): Promise<{ key: string; title: string }[]> {
    const visibility = createTicketVisibility(scope);
    const rows = await this.database.query(
      `
        SELECT
            work_items.key,
            work_items.title
        FROM work_items
        WHERE (
                work_items.key ILIKE $pattern ESCAPE '\\'
                OR work_items.title ILIKE $pattern ESCAPE '\\'
            )
            AND ${visibility.condition}
        ORDER BY work_items.key
        LIMIT ${Math.trunc(limit)};
      `,
      { ...visibility.parameters, pattern: `%${escapeLike(query)}%` },
    );

    return rows.map((row) => ({
      key: readTextColumn(row, 0, "key"),
      title: readTextColumn(row, 1, "title"),
    }));
  }
}

/** Applies the ticket rule to a viewer: administrators see every department. */
function createTicketVisibility(
  scope: WikiVisibilityScope,
): ReturnType<typeof createWorkItemVisibility> {
  return createWorkItemVisibility({
    departmentIds: scope.isAdmin ? null : scope.departmentIds,
    projectIds: scope.projectIds,
  });
}

/**
 * Escapes the characters that `LIKE` treats as wildcards.
 *
 * @param text - Text to match literally.
 * @returns The text with `\`, `%` and `_` escaped.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

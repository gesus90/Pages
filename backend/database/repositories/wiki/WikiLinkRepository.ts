import { createWorkItemVisibility } from "@/backend/database/repositories/task/WorkItemVisibility";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import {
  readSummary,
  WIKI_PAGE_JOINS,
  WIKI_SUMMARY_COLUMNS,
} from "./WikiPageRows";
import { createInCondition, createVisiblePagesQuery } from "./WikiVisibility";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  WikiPageSummary,
  WikiTicketSummary,
  WikiVisibilityScope,
} from "@/definition/Wiki";

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
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Replaces the links a page contains.
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
        ORDER BY project.name, project.creation_order;
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

  /**
   * Reads what ticket links in the wiki text show.
   * @param scope - What the viewer may see.
   * @param keys - Ticket keys read from the links.
   * @returns Status, title, person and version of the tickets the viewer may
   * see; hidden and missing tickets are left out alike.
   */
  public async findTicketSummaries(
    scope: WikiVisibilityScope,
    keys: readonly string[],
  ): Promise<WikiTicketSummary[]> {
    const visibility = createTicketVisibility(scope);
    const wanted = createInCondition("work_items.key", "ticket_key", keys);
    const rows = await this.database.query(
      `
        SELECT
            work_items.key,
            work_items.title,
            workflow_statuses.key AS status_key,
            workflow_statuses.name AS status_name,
            COALESCE(assignee.display_name, assignee_group.name) AS assignee_name,
            milestones.name AS milestone_name
        FROM work_items
        INNER JOIN workflow_statuses
            ON workflow_statuses.id = work_items.status_id
        LEFT JOIN users AS assignee
            ON assignee.id = work_items.assignee_id
        LEFT JOIN user_groups AS assignee_group
            ON assignee_group.id = work_items.assignee_group_id
        LEFT JOIN milestones
            ON milestones.id = work_items.milestone_id
        WHERE ${wanted.sql}
            AND ${visibility.condition}
        ORDER BY work_items.key;
      `,
      { ...visibility.parameters, ...wanted.parameters },
    );

    return rows.map((row) => ({
      assigneeName: readNullableTextColumn(row, 4, "assignee_name"),
      key: readTextColumn(row, 0, "key"),
      milestoneName: readNullableTextColumn(row, 5, "milestone_name"),
      statusKey: readTextColumn(row, 2, "status_key"),
      statusName: readTextColumn(row, 3, "status_name"),
      title: readTextColumn(row, 1, "title"),
    }));
  }
}

/**
 * Applies the ticket rule of the wiki to a viewer: administrators see every
 * department, everybody else the tickets of readable projects without a
 * department or of one of their own departments.
 * @param scope - What the viewer may see.
 * @returns The condition on the alias `work_items` and its values.
 */
export function createTicketVisibility(
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

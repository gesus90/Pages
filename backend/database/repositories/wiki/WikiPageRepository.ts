import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import {
  readCount,
  readPageRecord,
  readScope,
  readSummary,
  WIKI_PAGE_COLUMNS,
  WIKI_PAGE_JOINS,
  WIKI_SUMMARY_COLUMNS,
} from "./WikiPageRows";
import { createInCondition, createVisiblePagesQuery } from "./WikiVisibility";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  WikiPageLink,
  WikiPageSummary,
  WikiScope,
  WikiTreeNode,
  WikiVisibilityScope,
} from "@/definition/Wiki";
import type { WikiPageRecord } from "./WikiPageRows";
import type { VisiblePagesOptions } from "./WikiVisibility";

/** What the service needs to know about a page before it changes it. */
export interface WikiNodeRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly ownerId: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly deletedRootId: string | null;
  readonly isTemplate: boolean;
}

/** A deleted page that can be restored. */
export interface WikiTrashEntry extends WikiPageLink {
  readonly scope: WikiScope;
  readonly projectName: string | null;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly deletedAt: string;
  readonly deletedByName: string | null;
  readonly parentTitle: string | null;
}

const NODE_COLUMNS = `
    page.id,
    page.parent_id,
    page.scope,
    page.project_id,
    page.owner_id,
    page.revision,
    page.deleted_at,
    page.deleted_root_id,
    page.is_template
`;

/** Reads wiki pages, their tree and their trash. */
export class WikiPageRepository {
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
   * Reads a page the viewer may see.
   *
   * @param scope - What the viewer may see.
   * @param id - Page identifier.
   * @param options - Set `includeDeleted` to find pages in the trash.
   * @returns The page, or `null` when it is missing or hidden.
   */
  public async findVisible(
    scope: WikiVisibilityScope,
    id: string,
    options: VisiblePagesOptions = {},
  ): Promise<WikiPageRecord | null> {
    const visible = createVisiblePagesQuery(scope, options);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT ${WIKI_PAGE_COLUMNS}
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        ${WIKI_PAGE_JOINS}
        WHERE page.id = $page_id;
      `,
      { ...visible.parameters, page_id: id },
    );
    const row = rows[0];

    return row ? readPageRecord(row) : null;
  }

  /**
   * Lists the pages of the navigation, without templates.
   *
   * @param scope - What the viewer may see.
   * @returns Visible pages in sibling order.
   */
  public async listNodes(scope: WikiVisibilityScope): Promise<WikiTreeNode[]> {
    const visible = createVisiblePagesQuery(scope);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT
            page.id,
            page.parent_id,
            page.title,
            page.icon,
            page.scope,
            page.project_id,
            page.position,
            page.current_until
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        WHERE page.is_template = 0
        ORDER BY page.position, page.created_at, page.id;
      `,
      visible.parameters,
    );

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      parentId: readNullableTextColumn(row, 1, "parent_id"),
      title: readTextColumn(row, 2, "title"),
      icon: readNullableTextColumn(row, 3, "icon"),
      scope: readScope(row, 4),
      projectId: readNullableTextColumn(row, 5, "project_id"),
      position: readCount(row, 6, "position"),
      currentUntil: readNullableTextColumn(row, 7, "current_until"),
    }));
  }

  /**
   * Lists the pages for the table "All pages".
   *
   * @param scope - What the viewer may see.
   * @returns Visible pages, newest edit first.
   */
  public async listSummaries(
    scope: WikiVisibilityScope,
  ): Promise<WikiPageSummary[]> {
    const visible = createVisiblePagesQuery(scope);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT ${WIKI_SUMMARY_COLUMNS}
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        ${WIKI_PAGE_JOINS}
        WHERE page.is_template = 0
        ORDER BY page.updated_at DESC, page.id;
      `,
      visible.parameters,
    );

    return rows.map(readSummary);
  }

  /**
   * Lists the templates the viewer may use.
   *
   * @param scope - What the viewer may see.
   * @returns Visible template pages by title.
   */
  public async listTemplates(
    scope: WikiVisibilityScope,
  ): Promise<WikiPageRecord[]> {
    const visible = createVisiblePagesQuery(scope);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT ${WIKI_PAGE_COLUMNS}
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        ${WIKI_PAGE_JOINS}
        WHERE page.is_template = 1
        ORDER BY page.title, page.id;
      `,
      visible.parameters,
    );

    return rows.map(readPageRecord);
  }

  /**
   * Reads the titles of visible pages.
   *
   * @param scope - What the viewer may see.
   * @param ids - Page identifiers.
   * @returns Identifier and title of each page the viewer may see; hidden
   * and missing pages do not appear.
   */
  public async findTitles(
    scope: WikiVisibilityScope,
    ids: readonly string[],
  ): Promise<{ id: string; title: string }[]> {
    const visible = createVisiblePagesQuery(scope);
    const pages = createInCondition("page.id", "page", ids);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT
            page.id,
            page.title
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        WHERE ${pages.sql}
        ORDER BY page.id;
      `,
      { ...visible.parameters, ...pages.parameters },
    );

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      title: readTextColumn(row, 1, "title"),
    }));
  }

  /**
   * Lists the direct children of a page the viewer may see.
   *
   * @param scope - What the viewer may see.
   * @param parentId - Parent page identifier.
   * @returns Children in sibling order.
   */
  public async listChildren(
    scope: WikiVisibilityScope,
    parentId: string,
  ): Promise<WikiPageLink[]> {
    const visible = createVisiblePagesQuery(scope);
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT
            page.id,
            page.title,
            page.icon
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        WHERE page.parent_id = $parent_id
            AND page.is_template = 0
        ORDER BY page.position, page.created_at, page.id;
      `,
      { ...visible.parameters, parent_id: parentId },
    );

    return rows.map(readLink);
  }

  /**
   * Lists the pages above a page, from the root down.
   *
   * @param id - Page identifier; the caller has checked that it is visible,
   * which makes every ancestor visible too.
   * @returns The ancestors without the page itself.
   */
  public async findBreadcrumb(id: string): Promise<WikiPageLink[]> {
    const rows = await this.database.query(
      `
        WITH RECURSIVE ancestors (id, parent_id, title, icon, depth) AS (
            SELECT
                page.id,
                page.parent_id,
                page.title,
                page.icon,
                0
            FROM wiki_pages AS page
            WHERE page.id = $page_id
            UNION ALL
            SELECT
                parent.id,
                parent.parent_id,
                parent.title,
                parent.icon,
                ancestors.depth + 1
            FROM wiki_pages AS parent
            INNER JOIN ancestors
                ON parent.id = ancestors.parent_id
        )
        SELECT
            id,
            title,
            icon
        FROM ancestors
        WHERE depth > 0
        ORDER BY depth DESC;
      `,
      { page_id: id },
    );

    return rows.map(readLink);
  }

  /**
   * Reads what the service needs to know about a page, visible or not.
   *
   * @param id - Page identifier.
   * @returns The record, or `null` when no such page exists.
   *
   * @remarks
   * Only for pages the caller has already checked, or for ids the server
   * created itself.
   */
  public async findNode(id: string): Promise<WikiNodeRecord | null> {
    const rows = await this.database.query(
      `
        SELECT ${NODE_COLUMNS}
        FROM wiki_pages AS page
        WHERE page.id = $page_id;
      `,
      { page_id: id },
    );
    const row = rows[0];

    return row ? readNode(row) : null;
  }

  /**
   * Counts how many levels lie above a page.
   *
   * @param id - Page identifier.
   * @returns 0 for a root page.
   */
  public async countLevelsAbove(id: string): Promise<number> {
    const breadcrumb = await this.findBreadcrumb(id);

    return breadcrumb.length;
  }

  /**
   * Counts how many levels a page's subtree has below the page.
   *
   * @param id - Page identifier.
   * @returns 0 for a page without children.
   */
  public async countLevelsBelow(id: string): Promise<number> {
    const rows = await this.database.query(
      `
        WITH RECURSIVE subtree (id, depth) AS (
            SELECT
                page.id,
                0
            FROM wiki_pages AS page
            WHERE page.id = $page_id
            UNION ALL
            SELECT
                page.id,
                subtree.depth + 1
            FROM wiki_pages AS page
            INNER JOIN subtree
                ON page.parent_id = subtree.id
        )
        SELECT MAX(depth) FROM subtree;
      `,
      { page_id: id },
    );
    const row = rows[0];

    return row ? readCount(row, 0, "depth") : 0;
  }

  /**
   * Lists a page and everything below it.
   *
   * @param id - Page identifier.
   * @returns The identifiers, the page first.
   */
  public async findSubtreeIds(id: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        WITH RECURSIVE subtree (id, depth) AS (
            SELECT
                page.id,
                0
            FROM wiki_pages AS page
            WHERE page.id = $page_id
            UNION ALL
            SELECT
                page.id,
                subtree.depth + 1
            FROM wiki_pages AS page
            INNER JOIN subtree
                ON page.parent_id = subtree.id
        )
        SELECT id FROM subtree ORDER BY depth, id;
      `,
      { page_id: id },
    );

    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /**
   * Lists the pages in the trash a viewer may restore.
   *
   * @param scope - What the viewer may see, ignoring the trash.
   * @param ownedOnly - Restrict the list to pages the viewer owns.
   * @returns Deleted pages that were deleted as such, newest first.
   */
  public async listTrash(
    scope: WikiVisibilityScope,
    ownedOnly: boolean,
  ): Promise<WikiTrashEntry[]> {
    const visible = createVisiblePagesQuery(scope, { includeDeleted: true });
    const rows = await this.database.query(
      `
        ${visible.sql}
        SELECT
            page.id,
            page.title,
            page.icon,
            page.scope,
            project.name,
            page.owner_id,
            owner.display_name,
            page.deleted_at,
            remover.display_name,
            parent.title
        FROM wiki_pages AS page
        INNER JOIN visible_pages
            ON visible_pages.id = page.id
        ${WIKI_PAGE_JOINS}
        LEFT JOIN users AS remover
            ON remover.id = page.deleted_by
        LEFT JOIN wiki_pages AS parent
            ON parent.id = page.parent_id
        WHERE page.deleted_root_id = page.id
            AND (NOT $owned_only OR page.owner_id = $viewer_id)
        ORDER BY page.deleted_at DESC, page.id;
      `,
      { ...visible.parameters, owned_only: ownedOnly },
    );

    return rows.map((row) => ({
      deletedAt: readTextColumn(row, 7, "deleted_at"),
      deletedByName: readNullableTextColumn(row, 8, "deleted_by_name"),
      icon: readNullableTextColumn(row, 2, "icon"),
      id: readTextColumn(row, 0, "id"),
      ownerId: readTextColumn(row, 5, "owner_id"),
      ownerName: readNullableTextColumn(row, 6, "owner_name") ?? "",
      parentTitle: readNullableTextColumn(row, 9, "parent_title"),
      projectName: readNullableTextColumn(row, 4, "project_name"),
      scope: readScope(row, 3),
      title: readTextColumn(row, 1, "title"),
    }));
  }

  /**
   * Lists the roots of deleted trees that outlived the retention time.
   *
   * @param retentionDays - Days a deleted page stays in the trash.
   * @returns Identifiers of the pages that were deleted as roots.
   */
  public async findExpiredTrashRoots(retentionDays: number): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT page.id
        FROM wiki_pages AS page
        WHERE page.deleted_root_id = page.id
            AND page.deleted_at <= utc_after(
                to_days(CAST(-$retention_days AS INTEGER))
            )
        ORDER BY page.id;
      `,
      { retention_days: retentionDays },
    );

    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /**
   * Counts the private pages of every owner.
   *
   * @returns Owner identifier mapped to the number of live private pages.
   */
  public async countPrivateByOwner(): Promise<ReadonlyMap<string, number>> {
    const rows = await this.database.query(
      `
        SELECT
            page.owner_id,
            COUNT(*)
        FROM wiki_pages AS page
        WHERE page.scope = 'private'
            AND page.deleted_at IS NULL
        GROUP BY page.owner_id;
      `,
    );

    return new Map(
      rows.map((row) => [
        readTextColumn(row, 0, "owner_id"),
        readCount(row, 1, "count"),
      ]),
    );
  }

  /**
   * Lists the private pages of one owner, for the administrator's
   * placeholders: the identifier only, never a title or text.
   *
   * @param ownerId - Owner of the pages.
   * @returns Page identifiers, newest first.
   */
  public async findPrivateIds(ownerId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT page.id
        FROM wiki_pages AS page
        WHERE page.scope = 'private'
            AND page.owner_id = $owner_id
            AND page.deleted_at IS NULL
        ORDER BY page.created_at DESC, page.id;
      `,
      { owner_id: ownerId },
    );

    return rows.map((row) => readTextColumn(row, 0, "id"));
  }
}

function readLink(row: readonly DatabaseValue[]): WikiPageLink {
  return {
    icon: readNullableTextColumn(row, 2, "icon"),
    id: readTextColumn(row, 0, "id"),
    title: readTextColumn(row, 1, "title"),
  };
}

function readNode(row: readonly DatabaseValue[]): WikiNodeRecord {
  return {
    deletedAt: readNullableTextColumn(row, 6, "deleted_at"),
    deletedRootId: readNullableTextColumn(row, 7, "deleted_root_id"),
    id: readTextColumn(row, 0, "id"),
    isTemplate: readCount(row, 8, "is_template") === 1,
    ownerId: readTextColumn(row, 4, "owner_id"),
    parentId: readNullableTextColumn(row, 1, "parent_id"),
    projectId: readNullableTextColumn(row, 3, "project_id"),
    revision: readCount(row, 5, "revision"),
    scope: readScope(row, 2),
  };
}

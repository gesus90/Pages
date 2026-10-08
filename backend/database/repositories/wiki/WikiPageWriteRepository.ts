import { readTextColumn } from "@/backend/database/RowValue";

import { readCount } from "./WikiPageRows";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiScope } from "@/definition/Wiki";

/** Values of a page that is created. */
export interface NewWikiPage {
  readonly id: string;
  readonly parentId: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly ownerId: string;
  readonly authorId: string;
  readonly title: string;
  readonly icon: string | null;
  readonly content: string;
  readonly isTemplate: boolean;
}

/** Values the editor changes; the revision rises with every change. */
export interface WikiPageEdit {
  readonly title: string;
  readonly content: string;
  readonly icon: string | null;
  readonly editorId: string;
}

/** Where a page and its subtree go. */
export interface WikiPlacement {
  readonly parentId: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
}

/** Owns the changes to wiki pages. */
export class WikiPageWriteRepository {
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
   * Returns the position a new sibling takes: after all existing ones.
   *
   * @param placement - Parent, scope and project of the new page.
   * @param ownerId - Owner, which separates private root pages.
   * @returns The next position.
   */
  public async nextPosition(
    placement: WikiPlacement,
    ownerId: string,
  ): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT COALESCE(MAX(page.position), 0) + 1
        FROM wiki_pages AS page
        WHERE page.parent_id IS NOT DISTINCT FROM $parent_id
            AND page.scope = $scope
            AND page.project_id IS NOT DISTINCT FROM $project_id
            AND (page.scope <> 'private' OR page.owner_id = $owner_id)
            AND page.deleted_at IS NULL;
      `,
      {
        owner_id: ownerId,
        parent_id: placement.parentId,
        project_id: placement.projectId,
        scope: placement.scope,
      },
    );
    const row = rows[0];

    return row ? readCount(row, 0, "position") : 1;
  }

  /**
   * Stores a new page.
   *
   * @param page - Validated values.
   * @param position - Position among its siblings.
   */
  public async insert(page: NewWikiPage, position: number): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO wiki_pages (
            id,
            scope,
            project_id,
            parent_id,
            position,
            owner_id,
            author_id,
            updated_by,
            title,
            icon,
            content,
            is_template
        )
        VALUES (
            $id,
            $scope,
            $project_id,
            $parent_id,
            $position,
            $owner_id,
            $author_id,
            $author_id,
            $title,
            $icon,
            $content,
            $is_template
        );
      `,
      {
        author_id: page.authorId,
        content: page.content,
        icon: page.icon,
        id: page.id,
        is_template: page.isTemplate ? 1 : 0,
        owner_id: page.ownerId,
        parent_id: page.parentId,
        position,
        project_id: page.projectId,
        scope: page.scope,
        title: page.title,
      },
    );
  }

  /**
   * Stores an edit and raises the revision.
   *
   * @param id - Page identifier.
   * @param edit - New values.
   * @returns The new revision.
   */
  public async saveEdit(id: string, edit: WikiPageEdit): Promise<number> {
    const rows = await this.database.query(
      `
        UPDATE wiki_pages
        SET
            title = $title,
            content = $content,
            icon = $icon,
            updated_by = $editor_id,
            revision = revision + 1,
            updated_at = utc_now()
        WHERE id = $id
        RETURNING revision;
      `,
      {
        content: edit.content,
        editor_id: edit.editorId,
        icon: edit.icon,
        id,
        title: edit.title,
      },
    );
    const row = rows[0];

    return row ? readCount(row, 0, "revision") : 0;
  }

  /**
   * Places a page below a parent.
   *
   * @param id - Page identifier.
   * @param placement - New parent, scope and project.
   * @param position - Position among the new siblings.
   * @param editorId - Account that moves the page.
   */
  public async place(
    id: string,
    placement: WikiPlacement,
    position: number,
    editorId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE wiki_pages
        SET
            parent_id = $parent_id,
            scope = $scope,
            project_id = $project_id,
            position = $position,
            updated_by = $editor_id,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      {
        editor_id: editorId,
        id,
        parent_id: placement.parentId,
        position,
        project_id: placement.projectId,
        scope: placement.scope,
      },
    );
  }

  /**
   * Applies the scope of a moved page to everything below it.
   *
   * @param id - Page identifier whose descendants change.
   * @param placement - Scope and project to apply.
   */
  public async applyScopeToDescendants(
    id: string,
    placement: WikiPlacement,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE wiki_pages
        SET
            scope = $scope,
            project_id = $project_id
        WHERE id IN (
            WITH RECURSIVE subtree (id) AS (
                SELECT page.id
                FROM wiki_pages AS page
                WHERE page.parent_id = $page_id
                UNION ALL
                SELECT page.id
                FROM wiki_pages AS page
                INNER JOIN subtree
                    ON page.parent_id = subtree.id
            )
            SELECT id FROM subtree
        );
      `,
      {
        page_id: id,
        project_id: placement.projectId,
        scope: placement.scope,
      },
    );
  }

  /**
   * Writes the order of a list of siblings.
   *
   * @param orderedIds - Sibling identifiers in their new order.
   */
  public async writePositions(orderedIds: readonly string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await this.database.execute(
        "UPDATE wiki_pages SET position = $position WHERE id = $id;",
        { id, position: index + 1 },
      );
    }
  }

  /**
   * Lists the siblings of a placement, deleted pages excluded.
   *
   * @param placement - Parent, scope and project.
   * @param ownerId - Owner, which separates private root pages.
   * @returns Sibling identifiers in order.
   */
  public async findSiblingIds(
    placement: WikiPlacement,
    ownerId: string,
  ): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT page.id
        FROM wiki_pages AS page
        WHERE page.parent_id IS NOT DISTINCT FROM $parent_id
            AND page.scope = $scope
            AND page.project_id IS NOT DISTINCT FROM $project_id
            AND (page.scope <> 'private' OR page.owner_id = $owner_id)
            AND page.deleted_at IS NULL
        ORDER BY page.position, page.created_at, page.id;
      `,
      {
        owner_id: ownerId,
        parent_id: placement.parentId,
        project_id: placement.projectId,
        scope: placement.scope,
      },
    );

    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /**
   * Sets or clears the date until which a page counts as up to date.
   *
   * @param id - Page identifier.
   * @param currentUntil - Date as `YYYY-MM-DD`, or `null` to clear it.
   */
  public async setCurrentUntil(
    id: string,
    currentUntil: string | null,
  ): Promise<void> {
    await this.database.execute(
      "UPDATE wiki_pages SET current_until = $current_until WHERE id = $id;",
      { current_until: currentUntil, id },
    );
  }

  /**
   * Changes the owner of a page.
   *
   * @param id - Page identifier.
   * @param ownerId - New owner.
   */
  public async setOwner(id: string, ownerId: string): Promise<void> {
    await this.database.execute(
      "UPDATE wiki_pages SET owner_id = $owner_id WHERE id = $id;",
      { id, owner_id: ownerId },
    );
  }

  /**
   * Marks a page and its subtree as deleted.
   *
   * @param id - Page identifier that the user deletes.
   * @param userId - Account that deletes.
   */
  public async markDeleted(id: string, userId: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE wiki_pages
        SET
            deleted_at = utc_now(),
            deleted_by = $user_id,
            deleted_root_id = $page_id
        WHERE id IN (
            WITH RECURSIVE subtree (id) AS (
                SELECT page.id
                FROM wiki_pages AS page
                WHERE page.id = $page_id
                UNION ALL
                SELECT page.id
                FROM wiki_pages AS page
                INNER JOIN subtree
                    ON page.parent_id = subtree.id
                WHERE page.deleted_at IS NULL
            )
            SELECT id FROM subtree
        );
      `,
      { page_id: id, user_id: userId },
    );
  }

  /**
   * Brings a deleted page and the pages deleted with it back.
   *
   * @param id - Identifier of the page that was deleted.
   */
  public async clearDeleted(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE wiki_pages
        SET
            deleted_at = NULL,
            deleted_by = NULL,
            deleted_root_id = NULL
        WHERE deleted_root_id = $page_id;
      `,
      { page_id: id },
    );
  }
}

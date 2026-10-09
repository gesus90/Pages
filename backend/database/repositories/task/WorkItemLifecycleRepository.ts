import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { createInClause } from "./InClause";
import { createWorkItemVisibility } from "./WorkItemVisibility";
import { deleteAssistantConversations } from "../assistant/AssistantConversationDeletion";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { WorkItemVisibility } from "@/definition/Task";

/** Recursive selection of a work item and all its descendants, archived or not. */
const SUBTREE_CTE = `
  WITH RECURSIVE subtree (id) AS (
      SELECT id
      FROM work_items
      WHERE id = $root_id
      UNION
      SELECT work_items.id
      FROM work_items
      INNER JOIN subtree
          ON work_items.parent_id = subtree.id
  )
`;

/** Tables whose rows belong to a single work item and vanish with it. */
const OWNED_ROW_TABLES = [
  "work_item_history",
  "work_item_checklist_items",
  "work_item_labels",
  "work_item_attachments",
] as const;

/** How many descendants of one type, active or archived, a work item has. */
export interface DescendantCount {
  readonly type: string;
  readonly isActive: boolean;
  readonly count: number;
}

/** Archives, restores and permanently removes whole work item subtrees. */
export class WorkItemLifecycleRepository {
  private readonly database: Database;

  /**
   * Creates a work item lifecycle repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns the ids of a work item and all its descendants.
   *
   * @param rootId - Work item starting the subtree.
   * @param visibility - When given, only the members within this scope; the
   * traversal itself is unaffected, so hidden items never cut off a branch.
   */
  public async findSubtreeIds(
    rootId: string,
    visibility?: WorkItemVisibility,
  ): Promise<string[]> {
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        ${SUBTREE_CTE}
        SELECT work_items.id
        FROM work_items
        WHERE work_items.id IN (SELECT id FROM subtree)
            AND ${scope.condition}
        ORDER BY work_items.id;
      `,
      { root_id: rootId, ...scope.parameters },
    );

    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /**
   * Counts the descendants of a work item, without the work item itself.
   *
   * @param rootId - Work item starting the subtree.
   * @param visibility - Counts only the descendants within this scope.
   * @returns One count per type and state that occurs.
   */
  public async countDescendants(
    rootId: string,
    visibility?: WorkItemVisibility,
  ): Promise<DescendantCount[]> {
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        ${SUBTREE_CTE}
        SELECT
            work_items.type,
            work_items.archived_at IS NULL AS is_active,
            COUNT(*) AS descendant_count
        FROM work_items
        WHERE work_items.id IN (SELECT id FROM subtree)
            AND work_items.id <> $root_id
            AND ${scope.condition}
        GROUP BY
            work_items.type,
            work_items.archived_at IS NULL
        ORDER BY work_items.type;
      `,
      { root_id: rootId, ...scope.parameters },
    );

    return rows.map((row) => ({
      count: readCountColumn(row, 2, "descendant_count"),
      isActive: readBooleanColumn(row, 1, "is_active"),
      type: readTextColumn(row, 0, "type"),
    }));
  }

  /**
   * Removes the parent of the direct children of a work item, so they stay
   * when the work item is archived or deleted.
   *
   * @param parentId - The work item whose children are released.
   * @param scope - `active` releases only active children, so archived ones
   * stay in the archive of their parent; `all` releases every child.
   * @returns The ids of the released children.
   */
  public async detachChildren(
    parentId: string,
    scope: "active" | "all",
  ): Promise<string[]> {
    return this.database.transaction(async (transaction) => {
      const condition = scope === "active" ? "AND archived_at IS NULL" : "";
      const rows = await transaction.query(
        `
          SELECT id
          FROM work_items
          WHERE parent_id = $parent_id
              ${condition}
          ORDER BY id;
        `,
        { parent_id: parentId },
      );

      await transaction.execute(
        `
          UPDATE work_items
          SET
              parent_id = NULL,
              updated_at = utc_now()
          WHERE parent_id = $parent_id
              ${condition};
        `,
        { parent_id: parentId },
      );

      return rows.map((row) => readTextColumn(row, 0, "id"));
    });
  }

  /**
   * Lists the stored attachment files of a work item and its descendants,
   * which a permanent deletion leaves behind on the disk.
   *
   * @param rootId - Work item starting the subtree.
   * @returns Storage names of the attached files.
   */
  public async findSubtreeStorageNames(rootId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        ${SUBTREE_CTE}
        SELECT work_item_attachments.storage_name
        FROM work_item_attachments
        WHERE work_item_attachments.work_item_id IN (SELECT id FROM subtree)
        ORDER BY work_item_attachments.storage_name;
      `,
      { root_id: rootId },
    );

    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }

  /** Marks the given work items as archived. */
  public async archiveMany(ids: readonly string[]): Promise<void> {
    await this.setArchived(ids, "utc_now()", "IS NULL");
  }

  /** Brings the given archived work items back. */
  public async restoreMany(ids: readonly string[]): Promise<void> {
    await this.setArchived(ids, "NULL", "IS NOT NULL");
  }

  /**
   * Physically removes a work item with every descendant and all data tied to them.
   *
   * @param rootId - Work item starting the removed subtree.
   * @returns The ids that were removed, empty when the work item is unknown.
   *
   * @remarks
   * The schema has no foreign key cascades, so every dependent row is removed
   * explicitly inside one transaction. Pull requests and imported external
   * issues belong to GitHub and only lose their link to the ticket.
   */
  public async deleteSubtree(rootId: string): Promise<string[]> {
    return this.database.transaction(async (transaction) => {
      const ids = await this.readSubtreeIds(transaction, rootId);

      if (ids.length === 0) {
        return ids;
      }

      const { parameters, placeholders } = createInClause("item_id", ids);

      await deleteAssistantConversations(transaction, {
        condition: `context_kind = 'ticket' AND context_id IN (${placeholders})`,
        parameters,
      });

      for (const table of OWNED_ROW_TABLES) {
        await transaction.execute(
          `DELETE FROM ${table} WHERE work_item_id IN (${placeholders});`,
          parameters,
        );
      }

      await transaction.execute(
        `
          DELETE FROM work_item_links
          WHERE work_item_id IN (${placeholders})
              OR linked_work_item_id IN (${placeholders});
        `,
        parameters,
      );
      await transaction.execute(
        `DELETE FROM project_activity WHERE work_item_id IN (${placeholders});`,
        parameters,
      );
      await transaction.execute(
        `DELETE FROM work_item_tree_expansions WHERE node_key IN (${placeholders});`,
        parameters,
      );
      await transaction.execute(
        `
          UPDATE github_pull_requests
          SET work_item_id = NULL
          WHERE work_item_id IN (${placeholders});
        `,
        parameters,
      );
      await transaction.execute(
        `
          UPDATE github_external_issues
          SET imported_work_item_id = NULL
          WHERE imported_work_item_id IN (${placeholders});
        `,
        parameters,
      );
      await transaction.execute(
        `DELETE FROM work_items WHERE id IN (${placeholders});`,
        parameters,
      );

      return ids;
    });
  }

  private async readSubtreeIds(
    transaction: DatabaseTransaction,
    rootId: string,
  ): Promise<string[]> {
    const rows = await transaction.query(
      `${SUBTREE_CTE} SELECT id FROM subtree ORDER BY id;`,
      { root_id: rootId },
    );

    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  private async setArchived(
    ids: readonly string[],
    archivedAt: "utc_now()" | "NULL",
    currentState: "IS NULL" | "IS NOT NULL",
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const { parameters, placeholders } = createInClause("item_id", ids);

    await this.database.execute(
      `
        UPDATE work_items
        SET
            archived_at = ${archivedAt},
            updated_at = utc_now()
        WHERE id IN (${placeholders})
            AND archived_at ${currentState};
      `,
      parameters,
    );
  }
}

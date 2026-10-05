import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { WorkItemChecklistItem } from "@/definition/Task";

/** Values required to append a checklist item to a work item. */
export interface NewChecklistItem {
  readonly id: string;
  readonly workItemId: string;
  readonly title: string;
}

/** Values that can be changed on a checklist item. */
export interface ChecklistItemUpdate {
  readonly title: string;
  readonly isDone: boolean;
}

function toWorkItemChecklistItem(
  row: readonly DatabaseValue[],
): WorkItemChecklistItem {
  return {
    createdAt: readTextColumn(row, 5, "created_at"),
    id: readTextColumn(row, 0, "id"),
    isDone: readBooleanColumn(row, 3, "is_done"),
    sortOrder: readCountColumn(row, 4, "sort_order"),
    title: readTextColumn(row, 2, "title"),
    updatedAt: readTextColumn(row, 6, "updated_at"),
    workItemId: readTextColumn(row, 1, "work_item_id"),
  };
}

/** Owns persistence operations for the checklist items of work items. */
export class WorkItemChecklistRepository {
  private readonly database: Database;

  /**
   * Creates a work item checklist repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns the checklist items of a work item, in their persisted order. */
  public async findByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemChecklistItem[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            work_item_id,
            title,
            is_done,
            sort_order,
            created_at,
            updated_at
        FROM work_item_checklist_items
        WHERE work_item_id = $work_item_id
        ORDER BY sort_order ASC, created_at ASC;
      `,
      { work_item_id: workItemId },
    );

    return rows.map(toWorkItemChecklistItem);
  }

  /** Returns a single checklist item by its identifier. */
  public async findById(id: string): Promise<WorkItemChecklistItem | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            work_item_id,
            title,
            is_done,
            sort_order,
            created_at,
            updated_at
        FROM work_item_checklist_items
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? toWorkItemChecklistItem(row) : null;
  }

  /** Appends a checklist item after the ticket's existing entries. */
  public async insert(item: NewChecklistItem): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_checklist_items (
            id,
            work_item_id,
            title,
            sort_order,
            created_at,
            updated_at
        )
        VALUES (
            $id,
            $work_item_id,
            $title,
            (
                SELECT COALESCE(MAX(sort_order), 0) + 1
                FROM work_item_checklist_items
                WHERE work_item_id = $work_item_id
            ),
            utc_now(),
            utc_now()
        );
      `,
      { id: item.id, title: item.title, work_item_id: item.workItemId },
    );
  }

  /** Renames a checklist item, toggles its done state, or both. */
  public async update(id: string, update: ChecklistItemUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_item_checklist_items
        SET
            title = $title,
            is_done = $is_done,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, is_done: update.isDone ? 1 : 0, title: update.title },
    );
  }

  /** Deletes a checklist item. */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_checklist_items
        WHERE id = $id;
      `,
      { id },
    );
  }
}

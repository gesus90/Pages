import { readTextColumn } from "@/backend/database/RowValue";

import { readOptionalTextColumn } from "./OptionalColumn";
import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { WorkItemHistory, WorkItemVisibility } from "@/definition/Task";

/** Entry to record in the audit trail. */
export interface NewWorkItemHistory {
  readonly id: string;
  readonly workItemId: string;
  readonly userId: string;
  readonly action: string;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

function toWorkItemHistory(row: readonly DatabaseValue[]): WorkItemHistory {
  return {
    action: readTextColumn(row, 4, "action"),
    createdAt: readTextColumn(row, 8, "created_at"),
    field: readOptionalTextColumn(row, 5, "field"),
    id: readTextColumn(row, 0, "id"),
    newValue: readOptionalTextColumn(row, 7, "new_value"),
    oldValue: readOptionalTextColumn(row, 6, "old_value"),
    userDisplayName: readOptionalTextColumn(row, 3, "user_display_name"),
    userId: readTextColumn(row, 2, "user_id"),
    workItemId: readTextColumn(row, 1, "work_item_id"),
  };
}

/** Owns persistence operations for the audit trail of work items. */
export class WorkItemHistoryRepository {
  private readonly database: Database;

  /**
   * Creates a work item history repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns work item history across all tasks of one project, newest last. */
  public async findByProjectId(
    projectId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemHistory[]> {
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            work_item_history.id,
            work_item_history.work_item_id,
            work_item_history.user_id,
            users.display_name AS user_display_name,
            work_item_history.action,
            work_item_history.field,
            work_item_history.old_value,
            work_item_history.new_value,
            work_item_history.created_at
        FROM work_item_history
        INNER JOIN work_items
            ON work_items.id = work_item_history.work_item_id
        LEFT JOIN users
            ON users.id = work_item_history.user_id
        WHERE work_items.project_id = $project_id
            AND ${scope.condition}
        ORDER BY work_item_history.created_at DESC
        LIMIT 200;
      `,
      { project_id: projectId, ...scope.parameters },
    );

    return rows.map(toWorkItemHistory);
  }

  /** Returns history records for a work item ordered from newest to oldest. */
  public async findByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemHistory[]> {
    const rows = await this.database.query(
      `
        SELECT
            work_item_history.id,
            work_item_history.work_item_id,
            work_item_history.user_id,
            users.display_name AS user_display_name,
            work_item_history.action,
            work_item_history.field,
            work_item_history.old_value,
            work_item_history.new_value,
            work_item_history.created_at
        FROM work_item_history
        LEFT JOIN users
            ON users.id = work_item_history.user_id
        WHERE work_item_history.work_item_id = $work_item_id
        ORDER BY work_item_history.created_at DESC;
      `,
      { work_item_id: workItemId },
    );

    return rows.map(toWorkItemHistory);
  }

  /** Records a history event for a work item. */
  public async insert(entry: NewWorkItemHistory): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_history (
            id,
            work_item_id,
            user_id,
            action,
            field,
            old_value,
            new_value,
            created_at
        )
        VALUES (
            $id,
            $work_item_id,
            $user_id,
            $action,
            $field,
            $old_value,
            $new_value,
            utc_now()
        );
      `,
      {
        action: entry.action,
        field: entry.field,
        id: entry.id,
        new_value: entry.newValue,
        old_value: entry.oldValue,
        user_id: entry.userId,
        work_item_id: entry.workItemId,
      },
    );
  }
}

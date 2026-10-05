import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { readOptionalTextColumn } from "./OptionalColumn";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { WorkflowStatus } from "@/definition/Task";

function toWorkflowStatus(row: readonly DatabaseValue[]): WorkflowStatus {
  return {
    id: readTextColumn(row, 0, "id"),
    isDone: readBooleanColumn(row, 5, "is_done"),
    key: readTextColumn(row, 2, "key"),
    name: readTextColumn(row, 3, "name"),
    position: readCountColumn(row, 4, "position"),
    projectId: readOptionalTextColumn(row, 1, "project_id"),
  };
}

/** Owns persistence operations for workflow statuses. */
export class WorkflowStatusRepository {
  private readonly database: Database;

  /**
   * Creates a workflow status repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns all workflow statuses ordered by position. */
  public async findAll(): Promise<WorkflowStatus[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          project_id,
          key,
          name,
          position,
          is_done
      FROM workflow_statuses
      ORDER BY position ASC;
    `);

    return rows.map(toWorkflowStatus);
  }

  /** Returns a workflow status by its identifier. */
  public async findById(id: string): Promise<WorkflowStatus | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            key,
            name,
            position,
            is_done
        FROM workflow_statuses
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? toWorkflowStatus(row) : null;
  }
}

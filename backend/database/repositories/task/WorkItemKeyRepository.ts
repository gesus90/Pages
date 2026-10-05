import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Owns the project key and the sequential ticket numbers of work items. */
export class WorkItemKeyRepository {
  private readonly database: Database;

  /**
   * Creates a work item key repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns the prefix key stored for a project or registers a newly generated one. */
  public async findOrCreateProjectKey(
    projectId: string,
    defaultKey: string,
  ): Promise<string> {
    const rows = await this.database.query(
      `
        SELECT
            key
        FROM project_keys
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (row) {
      return readTextColumn(row, 0, "key");
    }

    await this.database.execute(
      `
        INSERT INTO project_keys (
            project_id,
            key
        )
        VALUES (
            $project_id,
            $key
        )
        ON CONFLICT (project_id) DO NOTHING;
      `,
      { key: defaultKey, project_id: projectId },
    );

    const confirmationRows = await this.database.query(
      `
        SELECT
            key
        FROM project_keys
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const confirmedRow = confirmationRows[0];

    if (!confirmedRow) {
      return defaultKey;
    }

    return readTextColumn(confirmedRow, 0, "key");
  }

  /** Returns the next sequential ticket number for the given project. */
  public async getNextNumber(projectId: string): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT
            COALESCE(MAX(number), 0) + 1 AS next_number
        FROM work_items
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (!row) {
      return 1;
    }

    return readCountColumn(row, 0, "next_number");
  }
}

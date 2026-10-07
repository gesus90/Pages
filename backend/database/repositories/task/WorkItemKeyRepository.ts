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

  /**
   * Reserves consecutive ticket numbers of a project and returns the first.
   *
   * @remarks
   * The project counter only grows. A number is therefore never handed out
   * twice, even after its ticket was deleted or moved to another project.
   * Tickets that carry a higher number than the counter (data from before the
   * counter existed) raise the counter first.
   *
   * @param projectId - Project the numbers belong to; it needs a stored key.
   * @param count - How many consecutive numbers to reserve.
   * @returns The first reserved number.
   */
  public async reserveNumbers(
    projectId: string,
    count: number,
  ): Promise<number> {
    const rows = await this.database.query(
      `
        UPDATE project_keys
        SET last_number = GREATEST(
            COALESCE(last_number, 0),
            COALESCE(
                (
                    SELECT MAX(work_items.number)
                    FROM work_items
                    WHERE work_items.project_id = project_keys.project_id
                ),
                0
            )
        ) + $count
        WHERE project_id = $project_id
        RETURNING last_number;
      `,
      { count, project_id: projectId },
    );
    const row = rows[0];

    if (!row) {
      throw new Error(`Project "${projectId}" has no ticket key.`);
    }

    return readCountColumn(row, 0, "last_number") - count + 1;
  }
}

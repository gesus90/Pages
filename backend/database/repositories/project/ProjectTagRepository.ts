import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Owns persistence operations for project tags. */
export class ProjectTagRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates a project tag repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the tags assigned to the project. */
  public async findByProjectId(projectId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT
            tag
        FROM project_tags
        WHERE project_id = $project_id
        ORDER BY tag ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => readTextColumn(row, 0, "tag"));
  }

  /** Replaces all tags assigned to the project. */
  public async replace(
    projectId: string,
    tags: readonly string[],
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_tags
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );

    for (const tag of tags) {
      await this.database.execute(
        `
          INSERT INTO project_tags (
              project_id,
              tag
          )
          VALUES (
              $project_id,
              $tag
          )
          ON CONFLICT (project_id, tag) DO NOTHING;
        `,
        { project_id: projectId, tag },
      );
    }
  }
}

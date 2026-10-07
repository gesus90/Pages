import { readBlobColumn, readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Stored icon metadata and binary image content. */
export interface ProjectIcon {
  readonly mimeType: string;
  readonly filename: string;
  readonly data: Buffer;
}

/** Owns persistence operations for custom project icons. */
export class ProjectIconRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates a project icon repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the custom icon attached to a project. */
  public async findByProjectId(projectId: string): Promise<ProjectIcon | null> {
    const rows = await this.database.query(
      `
        SELECT
            mime_type,
            filename,
            data
        FROM project_icons
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      data: readBlobColumn(row, 2, "data"),
      filename: readTextColumn(row, 1, "filename"),
      mimeType: readTextColumn(row, 0, "mime_type"),
    };
  }

  /** Creates or replaces the custom icon attached to a project. */
  public async upsert(projectId: string, icon: ProjectIcon): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_icons (
            project_id,
            mime_type,
            filename,
            data,
            updated_at
        )
        VALUES (
            $project_id,
            $mime_type,
            $filename,
            $data,
            utc_now()
        )
        ON CONFLICT (project_id) DO UPDATE SET
            mime_type = excluded.mime_type,
            filename = excluded.filename,
            data = excluded.data,
            updated_at = utc_now();
      `,
      {
        project_id: projectId,
        mime_type: icon.mimeType,
        filename: icon.filename,
        data: icon.data,
      },
    );
  }
}

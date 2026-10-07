import { readTextColumn } from "@/backend/database/RowValue";
import { isProjectActivityCategory } from "@/definition/Project";

import { createWorkItemVisibility } from "../task/WorkItemVisibility";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { WorkItemVisibility } from "@/definition/Task";
import type {
  ProjectActivity,
  ProjectActivityCategory,
} from "@/definition/Project";

/** Entry recorded in the chronological project activity log. */
export interface NewProjectActivity {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly category: ProjectActivityCategory;
  readonly action: string;
  readonly message: string;
  /** Ticket reference used solely to enforce F9 on generated integration events. */
  readonly workItemId?: string;
}

function toProjectActivity(row: readonly DatabaseValue[]): ProjectActivity {
  const userDisplayName = row[3];

  if (userDisplayName !== null && typeof userDisplayName !== "string") {
    throw new Error(
      'Database returned an invalid value for "user_display_name".',
    );
  }

  const category = readTextColumn(row, 4, "category");

  if (!isProjectActivityCategory(category)) {
    throw new Error(
      `Database returned an unsupported activity category "${category}".`,
    );
  }

  return {
    id: readTextColumn(row, 0, "id"),
    projectId: readTextColumn(row, 1, "project_id"),
    userId: readTextColumn(row, 2, "user_id"),
    userDisplayName,
    category,
    action: readTextColumn(row, 5, "action"),
    message: readTextColumn(row, 6, "message"),
    createdAt: readTextColumn(row, 7, "created_at"),
  };
}

/** Owns persistence operations for the project activity log. */
export class ProjectActivityRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates a project activity repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the chronological activity log of a project, newest last. */
  public async findByProjectId(
    projectId: string,
    visibility?: WorkItemVisibility,
  ): Promise<ProjectActivity[]> {
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            project_activity.id,
            project_activity.project_id,
            project_activity.user_id,
            users.display_name,
            project_activity.category,
            project_activity.action,
            project_activity.message,
            project_activity.created_at
        FROM project_activity
        LEFT JOIN users
            ON users.id = project_activity.user_id
        WHERE project_activity.project_id = $project_id
            AND (
                (project_activity.work_item_id IS NULL AND project_activity.action <> 'github_conflict')
                OR EXISTS (
                    SELECT 1
                    FROM work_items
                    WHERE work_items.id = project_activity.work_item_id
                        AND ${scope.condition}
                )
            )
        ORDER BY project_activity.created_at ASC;
      `,
      { project_id: projectId, ...scope.parameters },
    );

    return rows.map(toProjectActivity);
  }

  /** Records an entry in the chronological project activity log. */
  public async insert(entry: NewProjectActivity): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_activity (
            id,
            project_id,
            user_id,
            category,
            action,
            message,
            work_item_id,
            created_at
        )
        VALUES (
            $id,
            $project_id,
            $user_id,
            $category,
            $action,
            $message,
            $work_item_id,
            utc_now()
        );
      `,
      {
        id: entry.id,
        project_id: entry.projectId,
        user_id: entry.userId,
        category: entry.category,
        action: entry.action,
        message: entry.message,
        work_item_id: entry.workItemId ?? null,
      },
    );
  }
}

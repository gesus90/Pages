import { readTextColumn } from "@/backend/database/RowValue";
import { isProjectActivityCategory } from "@/definition/Project";

import { createWorkItemVisibility } from "../task/WorkItemVisibility";
import { createVisiblePagesQuery } from "../wiki/WikiVisibility";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { WorkItemVisibility } from "@/definition/Task";
import type { WikiVisibilityScope } from "@/definition/Wiki";
import type {
  ProjectActivity,
  ProjectActivityCategory,
  ProjectActivitySource,
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
  /** Wiki reference used to filter activity with the current page visibility. */
  readonly wikiPageId?: string;
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
    source: readSource(row[8]),
  };
}

function readSource(input: DatabaseValue | undefined): ProjectActivitySource {
  if (input !== "ui" && input !== "mcp" && input !== "ai")
    throw new Error("Invalid project activity source.");
  return input;
}

/** Owns persistence operations for the project activity log. */
export class ProjectActivityRepository {
  private readonly database: DatabaseTransaction;
  private readonly source: ProjectActivitySource;

  /**
   * Creates a project activity repository.
   *
   * @param database - Central database access.
   */
  public constructor(
    database: DatabaseTransaction,
    source: ProjectActivitySource = "ui",
  ) {
    this.database = database;
    this.source = source;
  }

  /** Returns the chronological activity log of a project, newest last. */
  public async findByProjectId(
    projectId: string,
    visibility?: WorkItemVisibility,
    wikiScope?: WikiVisibilityScope,
  ): Promise<ProjectActivity[]> {
    const scope = createWorkItemVisibility(visibility);
    const wiki = wikiScope
      ? createVisiblePagesQuery(wikiScope, { includeDeleted: true })
      : { sql: "", parameters: {} };
    const wikiCondition = wikiScope
      ? "project_activity.wiki_page_id IN (SELECT id FROM visible_pages)"
      : "FALSE";
    const rows = await this.database.query(
      `
        ${wiki.sql}
        SELECT
            project_activity.id,
            project_activity.project_id,
            project_activity.user_id,
            users.display_name,
            project_activity.category,
            project_activity.action,
            project_activity.message,
            project_activity.created_at,
            project_activity.source
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
            AND (
                project_activity.category <> 'wiki'
                OR ${wikiCondition}
            )
        ORDER BY project_activity.created_at ASC, project_activity.id ASC;
      `,
      { project_id: projectId, ...scope.parameters, ...wiki.parameters },
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
            wiki_page_id,
            source,
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
            $wiki_page_id,
            $source,
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
        wiki_page_id: entry.wikiPageId ?? null,
        source: this.source,
      },
    );
  }
}

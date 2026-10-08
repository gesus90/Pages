import { deleteWikiPages } from "../wiki/WikiPageDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

const OWNED_PROJECT_DELETIONS = [
  "DELETE FROM project_departments WHERE project_id = $project_id;",
  "DELETE FROM project_members WHERE project_id = $project_id;",
  "DELETE FROM project_icons WHERE project_id = $project_id;",
  "DELETE FROM project_keys WHERE project_id = $project_id;",
  "DELETE FROM project_goals WHERE project_id = $project_id;",
  "DELETE FROM project_tags WHERE project_id = $project_id;",
  "DELETE FROM project_events WHERE project_id = $project_id;",
  "DELETE FROM project_activity WHERE project_id = $project_id;",
  "DELETE FROM project_integrations WHERE project_id = $project_id;",
  "DELETE FROM github_external_issues WHERE project_id = $project_id;",
  "DELETE FROM github_pull_requests WHERE project_id = $project_id;",
  "DELETE FROM milestone_dependencies WHERE project_id = $project_id;",
  "DELETE FROM milestones WHERE project_id = $project_id;",
  "DELETE FROM workflow_statuses WHERE project_id = $project_id;",
  "DELETE FROM tasks WHERE project_id = $project_id;",
  "DELETE FROM work_items WHERE project_id = $project_id;",
] as const;

/** Removes every owned project aggregate within the caller's transaction. */
export class ProjectLifecycleRepository {
  private readonly database: DatabaseTransaction;

  /** Binds destructive persistence to the same transaction as authorization. */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Cleans child records and cross-project links before removing the project itself. */
  public async delete(projectId: string): Promise<void> {
    await this.deleteTemplates(projectId);
    await this.deleteWorkItemChildren(projectId);
    // The project has no trash, so its pages go for good. Their attachment
    // files are removed by the orphan sweep of the wiki.
    await deleteWikiPages(this.database, {
      parameters: { project_id: projectId },
      sql: "SELECT id FROM wiki_pages WHERE project_id = $project_id",
    });
    for (const statement of OWNED_PROJECT_DELETIONS) {
      await this.database.execute(statement, { project_id: projectId });
    }
    await this.database.execute(
      `
      UPDATE projects
      SET parent_id = NULL, updated_at = utc_now()
      WHERE parent_id = $project_id;
    `,
      { project_id: projectId },
    );
    await this.database.execute(
      "DELETE FROM projects WHERE id = $project_id;",
      { project_id: projectId },
    );
  }

  private async deleteTemplates(projectId: string): Promise<void> {
    for (const table of [
      "project_template_goals",
      "project_template_tags",
    ] as const) {
      await this.database.execute(
        `
        DELETE FROM ${table}
        WHERE template_id IN (
            SELECT id FROM project_templates WHERE project_id = $project_id
        );
      `,
        { project_id: projectId },
      );
    }
    await this.database.execute(
      "DELETE FROM project_templates WHERE project_id = $project_id;",
      { project_id: projectId },
    );
  }

  private async deleteWorkItemChildren(projectId: string): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM work_item_history
      WHERE work_item_id IN (
          SELECT id FROM work_items WHERE project_id = $project_id
      );
    `,
      { project_id: projectId },
    );
    await this.database.execute(
      `
      DELETE FROM work_item_checklist_items
      WHERE work_item_id IN (
          SELECT id FROM work_items WHERE project_id = $project_id
      );
    `,
      { project_id: projectId },
    );
    await this.database.execute(
      `
      DELETE FROM work_item_links
      WHERE work_item_id IN (
          SELECT id FROM work_items WHERE project_id = $project_id
      ) OR linked_work_item_id IN (
          SELECT id FROM work_items WHERE project_id = $project_id
      );
    `,
      { project_id: projectId },
    );
    await this.database.execute(
      `
      DELETE FROM work_item_labels
      WHERE work_item_id IN (
          SELECT id FROM work_items WHERE project_id = $project_id
      );
    `,
      { project_id: projectId },
    );
  }
}

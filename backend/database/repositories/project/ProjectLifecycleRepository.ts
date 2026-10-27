import { deleteProjectAgentData } from "./ProjectAgentDeletion";
import { clearProjectReferences } from "./ProjectReferenceCleanup";
import { deleteProjectWiki } from "./ProjectWikiDeletion";
import { deleteProjectWorkItemData } from "./ProjectWorkItemDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { ProjectDeletionFiles } from "./ProjectDeletionFiles";

/** Rows that belong to the project alone; the tickets go last because the others select through them. */
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
  "DELETE FROM project_discord_connections WHERE project_id = $project_id;",
  "DELETE FROM discord_connection_attempts WHERE project_id = $project_id;",
  "DELETE FROM discord_deliveries WHERE project_id = $project_id;",
  "DELETE FROM github_external_issues WHERE project_id = $project_id;",
  "DELETE FROM github_pull_requests WHERE project_id = $project_id;",
  "DELETE FROM runner_deploy_keys WHERE project_id = $project_id;",
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

  /**
   * Removes the project, everything that belongs to it, and every reference to it.
   *
   * @param projectId - The project to delete.
   * @returns The files whose rows went; the caller removes them after the commit.
   *
   * @remarks
   * The schema has no foreign key cascades, so every dependent row is removed
   * explicitly. The project has no trash and no archive step here: pages,
   * tickets and plans are deleted outright. Shared objects such as people,
   * groups, departments, agents, labels and ticket templates stay and only
   * lose their link to the project. A repeated call finds nothing left to
   * delete and changes nothing else.
   */
  public async delete(projectId: string): Promise<ProjectDeletionFiles> {
    const parameters = { project_id: projectId };
    // The cleanup selects through rows that the deletions below remove, so it runs first.
    await clearProjectReferences(this.database, projectId);
    const agentRunRecords = await deleteProjectAgentData(
      this.database,
      projectId,
    );
    const ticketAttachments = await deleteProjectWorkItemData(
      this.database,
      projectId,
    );
    const wikiAttachments = await deleteProjectWiki(this.database, projectId);
    await this.deleteTemplates(projectId);
    for (const statement of OWNED_PROJECT_DELETIONS) {
      await this.database.execute(statement, parameters);
    }
    await this.database.execute(
      `
      UPDATE projects
      SET parent_id = NULL, updated_at = utc_now()
      WHERE parent_id = $project_id;
    `,
      parameters,
    );
    await this.database.execute(
      "DELETE FROM projects WHERE id = $project_id;",
      parameters,
    );
    return { agentRunRecords, ticketAttachments, wikiAttachments };
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
}

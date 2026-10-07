import { readTextColumn } from "@/backend/database/RowValue";
import { isProjectStatus } from "@/definition/Project";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ProjectTemplate } from "@/definition/Project";

function toTemplate(row: readonly DatabaseValue[]): ProjectTemplate {
  const status = readTextColumn(row, 4, "status");
  if (!isProjectStatus(status))
    throw new Error("Database returned an unsupported template status.");
  return {
    id: readTextColumn(row, 0, "id"),
    projectId: readTextColumn(row, 1, "project_id"),
    name: readTextColumn(row, 2, "name"),
    description: readTextColumn(row, 3, "description"),
    status,
    goals: [],
    tags: [],
  };
}

/** Persists one reusable snapshot per source project under the caller's transaction. */
export class ProjectTemplateRepository {
  private readonly database: DatabaseTransaction;

  /** Shares the project transaction for source checks and snapshot replacement. */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads snapshots with ordered goal titles and tags for service-side access filtering. */
  public async findAll(): Promise<ProjectTemplate[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          project_id,
          name,
          description,
          status
      FROM project_templates
      ORDER BY name, id;
    `);
    const templates = rows.map(toTemplate);
    const goals = await this.database.query(`
      SELECT
          template_id,
          title
      FROM project_template_goals
      ORDER BY template_id, position;
    `);
    const tags = await this.database.query(`
      SELECT
          template_id,
          tag
      FROM project_template_tags
      ORDER BY template_id, tag;
    `);
    return templates.map((template) => ({
      ...template,
      goals: goals
        .filter((row) => row[0] === template.id)
        .map((row) => readTextColumn(row, 1, "title")),
      tags: tags
        .filter((row) => row[0] === template.id)
        .map((row) => readTextColumn(row, 1, "tag")),
    }));
  }

  /** Creates or replaces the complete snapshot while retaining its stable identity. */
  public async save(template: ProjectTemplate): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO project_templates (id, project_id, name, description, status)
      VALUES ($id, $project_id, $name, $description, $status)
      ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status;
    `,
      {
        id: template.id,
        project_id: template.projectId,
        name: template.name,
        description: template.description,
        status: template.status,
      },
    );
    await this.database.execute(
      "DELETE FROM project_template_goals WHERE template_id = $id;",
      { id: template.id },
    );
    await this.database.execute(
      "DELETE FROM project_template_tags WHERE template_id = $id;",
      { id: template.id },
    );
    for (const [position, title] of template.goals.entries()) {
      await this.database.execute(
        `
        INSERT INTO project_template_goals (template_id, position, title)
        VALUES ($id, $position, $title);
      `,
        { id: template.id, position, title },
      );
    }
    for (const tag of new Set(template.tags)) {
      await this.database.execute(
        `
        INSERT INTO project_template_tags (template_id, tag)
        VALUES ($id, $tag);
      `,
        { id: template.id, tag },
      );
    }
  }
}

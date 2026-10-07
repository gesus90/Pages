import { readTextColumn } from "@/backend/database/RowValue";
import { isWorkItemPriority, isWorkItemType } from "@/definition/Task";
import { isTemplateScope } from "@/definition/WorkItemTemplate";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { WorkItemTemplate } from "@/definition/WorkItemTemplate";

/** The values of a template to store; the database sets the timestamps. */
export type NewWorkItemTemplate = Omit<
  WorkItemTemplate,
  "createdAt" | "updatedAt"
>;

/** The ids and checklist titles that hang off a template, by template id. */
interface TemplateParts {
  readonly departments: ReadonlyMap<string, string[]>;
  readonly projects: ReadonlyMap<string, string[]>;
  readonly labels: ReadonlyMap<string, string[]>;
  readonly checklist: ReadonlyMap<string, string[]>;
}

function groupByTemplate(
  rows: readonly (readonly DatabaseValue[])[],
  column: string,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const row of rows) {
    const templateId = readTextColumn(row, 0, "template_id");
    const values = groups.get(templateId) ?? [];

    values.push(readTextColumn(row, 1, column));
    groups.set(templateId, values);
  }

  return groups;
}

function toTemplate(
  row: readonly DatabaseValue[],
  parts: TemplateParts,
): WorkItemTemplate {
  const id = readTextColumn(row, 0, "id");
  const type = readTextColumn(row, 3, "type");
  const priority = readTextColumn(row, 6, "priority");
  const scope = readTextColumn(row, 7, "scope");

  if (!isWorkItemType(type) || !isWorkItemPriority(priority)) {
    throw new Error("Database returned an unsupported template content.");
  }

  if (!isTemplateScope(scope)) {
    throw new Error("Database returned an unsupported template scope.");
  }

  return {
    checklist: parts.checklist.get(id) ?? [],
    createdAt: readTextColumn(row, 8, "created_at"),
    departmentIds: parts.departments.get(id) ?? [],
    description: readTextColumn(row, 5, "description"),
    id,
    labelIds: parts.labels.get(id) ?? [],
    name: readTextColumn(row, 1, "name"),
    ownerId: readTextColumn(row, 2, "owner_id"),
    priority,
    projectIds: parts.projects.get(id) ?? [],
    scope,
    title: readTextColumn(row, 4, "title"),
    type,
    updatedAt: readTextColumn(row, 9, "updated_at"),
  };
}

async function deleteParts(
  transaction: DatabaseTransaction,
  templateId: string,
): Promise<void> {
  for (const table of [
    "work_item_template_departments",
    "work_item_template_projects",
    "work_item_template_labels",
    "work_item_template_checklist_items",
  ]) {
    await transaction.execute(`DELETE FROM ${table} WHERE template_id = $id;`, {
      id: templateId,
    });
  }
}

async function insertParts(
  transaction: DatabaseTransaction,
  template: NewWorkItemTemplate,
): Promise<void> {
  const links = [
    {
      column: "department_id",
      ids: template.departmentIds,
      table: "work_item_template_departments",
    },
    {
      column: "project_id",
      ids: template.projectIds,
      table: "work_item_template_projects",
    },
    {
      column: "label_id",
      ids: template.labelIds,
      table: "work_item_template_labels",
    },
  ];

  for (const link of links) {
    for (const linkedId of new Set(link.ids)) {
      await transaction.execute(
        `INSERT INTO ${link.table} (template_id, ${link.column}) VALUES ($id, $linked_id);`,
        { id: template.id, linked_id: linkedId },
      );
    }
  }

  for (const [position, title] of template.checklist.entries()) {
    await transaction.execute(
      `
        INSERT INTO work_item_template_checklist_items (
            template_id,
            position,
            title
        )
        VALUES ($id, $position, $title);
      `,
      { id: template.id, position, title },
    );
  }
}

/** Owns persistence of ticket templates and what they are shared with. */
export class WorkItemTemplateRepository {
  private readonly database: Database;

  /**
   * Creates a ticket template repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns every template, ordered by name.
   *
   * @remarks
   * Labels that no longer exist in the catalog are left out, so a template
   * never offers a label that cannot be applied.
   */
  public async findAll(): Promise<WorkItemTemplate[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          name,
          owner_id,
          type,
          title,
          description,
          priority,
          scope,
          created_at,
          updated_at
      FROM work_item_templates
      ORDER BY lower(name), id;
    `);
    const parts = await this.findParts();

    return rows.map((row) => toTemplate(row, parts));
  }

  /** Returns a template by its identifier, or `null` when none exists. */
  public async findById(id: string): Promise<WorkItemTemplate | null> {
    const templates = await this.findAll();

    return templates.find((template) => template.id === id) ?? null;
  }

  /** Creates the template or replaces it completely, keeping its identity. */
  public async save(template: NewWorkItemTemplate): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          INSERT INTO work_item_templates (
              id,
              name,
              owner_id,
              type,
              title,
              description,
              priority,
              scope
          )
          VALUES (
              $id,
              $name,
              $owner_id,
              $type,
              $title,
              $description,
              $priority,
              $scope
          )
          ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              type = EXCLUDED.type,
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              priority = EXCLUDED.priority,
              scope = EXCLUDED.scope,
              updated_at = utc_now();
        `,
        {
          description: template.description,
          id: template.id,
          name: template.name,
          owner_id: template.ownerId,
          priority: template.priority,
          scope: template.scope,
          title: template.title,
          type: template.type,
        },
      );
      await deleteParts(transaction, template.id);
      await insertParts(transaction, template);
    });
  }

  /** Deletes a template with everything it is shared with. */
  public async delete(id: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await deleteParts(transaction, id);
      await transaction.execute(
        "DELETE FROM work_item_templates WHERE id = $id;",
        { id },
      );
    });
  }

  private async findParts(): Promise<TemplateParts> {
    const departments = await this.database.query(`
      SELECT
          template_id,
          department_id
      FROM work_item_template_departments
      ORDER BY template_id, department_id;
    `);
    const projects = await this.database.query(`
      SELECT
          template_id,
          project_id
      FROM work_item_template_projects
      ORDER BY template_id, project_id;
    `);
    const labels = await this.database.query(`
      SELECT
          work_item_template_labels.template_id,
          work_item_template_labels.label_id
      FROM work_item_template_labels
      INNER JOIN labels
          ON labels.id = work_item_template_labels.label_id
      ORDER BY
          work_item_template_labels.template_id,
          lower(labels.name);
    `);
    const checklist = await this.database.query(`
      SELECT
          template_id,
          title
      FROM work_item_template_checklist_items
      ORDER BY template_id, position;
    `);

    return {
      checklist: groupByTemplate(checklist, "title"),
      departments: groupByTemplate(departments, "department_id"),
      labels: groupByTemplate(labels, "label_id"),
      projects: groupByTemplate(projects, "project_id"),
    };
  }
}

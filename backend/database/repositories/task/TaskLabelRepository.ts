import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import { createInClause } from "./InClause";
import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { ProjectLabel, WorkItemVisibility } from "@/definition/Task";

/** Values required to persist a label in the catalog of a project. */
export interface NewProjectLabel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly color: string;
}

/** Values that can be changed on a project label. */
export interface ProjectLabelUpdate {
  readonly name: string;
  readonly color: string;
}

function toProjectLabel(row: readonly DatabaseValue[]): ProjectLabel {
  return {
    color: readTextColumn(row, 3, "color"),
    createdAt: readTextColumn(row, 4, "created_at"),
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 2, "name"),
    projectId: readTextColumn(row, 1, "project_id"),
    updatedAt: readTextColumn(row, 5, "updated_at"),
  };
}

function appendToGroup(
  groups: Map<string, ProjectLabel[]>,
  groupId: string,
  label: ProjectLabel,
): void {
  const group = groups.get(groupId);

  if (group) {
    group.push(label);
  } else {
    groups.set(groupId, [label]);
  }
}

/** Owns persistence operations for project labels and their ticket assignments. */
export class TaskLabelRepository {
  private readonly database: Database;

  /**
   * Creates a task label repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns the shared label catalog of a project ordered by name. */
  public async findByProjectId(projectId: string): Promise<ProjectLabel[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        FROM project_labels
        WHERE project_id = $project_id
        ORDER BY name ASC;
      `,
      { project_id: projectId },
    );

    return rows.map(toProjectLabel);
  }

  /** Returns the shared label catalogs of several projects ordered by name. */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    const labelsByProject = new Map<string, ProjectLabel[]>();

    if (projectIds.length === 0) {
      return labelsByProject;
    }

    const { parameters, placeholders } = createInClause(
      "label_project_id",
      projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        FROM project_labels
        WHERE project_id IN (${placeholders})
        ORDER BY name ASC;
      `,
      parameters,
    );

    for (const row of rows) {
      appendToGroup(
        labelsByProject,
        readTextColumn(row, 1, "project_id"),
        toProjectLabel(row),
      );
    }

    return labelsByProject;
  }

  /** Returns a project label by its identifier. */
  public async findById(id: string): Promise<ProjectLabel | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        FROM project_labels
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? toProjectLabel(row) : null;
  }

  /** Returns how many tickets currently use a label. */
  public async countUsage(
    labelId: string,
    visibility?: WorkItemVisibility,
  ): Promise<number> {
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*) AS usage_count
        FROM work_item_labels
        INNER JOIN work_items
            ON work_items.id = work_item_labels.work_item_id
        WHERE label_id = $label_id
            AND ${scope.condition};
      `,
      { label_id: labelId, ...scope.parameters },
    );
    const row = rows[0];

    if (!row) {
      return 0;
    }

    return readCountColumn(row, 0, "usage_count");
  }

  /**
   * Returns label usage counts for several projects with a single query.
   *
   * @returns Usage counts grouped by project id, then by label id.
   */
  public async countUsageByProjectIds(
    projectIds: readonly string[],
    visibility?: WorkItemVisibility,
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
    const usageByProject = new Map<string, Map<string, number>>();

    if (projectIds.length === 0) {
      return usageByProject;
    }

    const { parameters, placeholders } = createInClause(
      "usage_project_id",
      projectIds,
    );
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            project_labels.project_id,
            work_item_labels.label_id,
            COUNT(*) AS usage_count
        FROM work_item_labels
        INNER JOIN project_labels
            ON project_labels.id = work_item_labels.label_id
        INNER JOIN work_items
            ON work_items.id = work_item_labels.work_item_id
        WHERE project_labels.project_id IN (${placeholders})
            AND ${scope.condition}
        GROUP BY project_labels.project_id, work_item_labels.label_id;
      `,
      { ...parameters, ...scope.parameters },
    );

    for (const row of rows) {
      const projectId = readTextColumn(row, 0, "project_id");
      const labelId = readTextColumn(row, 1, "label_id");
      const count = readCountColumn(row, 2, "usage_count");
      let usage = usageByProject.get(projectId);

      if (!usage) {
        usage = new Map<string, number>();
        usageByProject.set(projectId, usage);
      }

      usage.set(labelId, count);
    }

    return usageByProject;
  }

  /** Inserts a label into the shared catalog of a project. */
  public async insert(label: NewProjectLabel): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_labels (
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $name,
            $color,
            utc_now(),
            utc_now()
        );
      `,
      {
        color: label.color,
        id: label.id,
        name: label.name,
        project_id: label.projectId,
      },
    );
  }

  /** Renames or recolors a project label; tickets reference it by id. */
  public async update(id: string, label: ProjectLabelUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_labels
        SET
            name = $name,
            color = $color,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, name: label.name, color: label.color },
    );
  }

  /** Deletes a project label and all of its ticket assignments. */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_labels
        WHERE label_id = $label_id;
      `,
      { label_id: id },
    );
    await this.database.execute(
      `
        DELETE FROM project_labels
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Returns the labels of the given work items mapped by work item id. */
  public async findByWorkItemIds(
    workItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    const labelsByWorkItem = new Map<string, ProjectLabel[]>();

    if (workItemIds.length === 0) {
      return labelsByWorkItem;
    }

    const { parameters, placeholders } = createInClause(
      "work_item_id",
      workItemIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            work_item_labels.work_item_id,
            project_labels.id,
            project_labels.project_id,
            project_labels.name,
            project_labels.color,
            project_labels.created_at,
            project_labels.updated_at
        FROM work_item_labels
        INNER JOIN project_labels
            ON project_labels.id = work_item_labels.label_id
        WHERE work_item_labels.work_item_id IN (${placeholders})
        ORDER BY project_labels.name ASC;
      `,
      parameters,
    );

    for (const row of rows) {
      appendToGroup(
        labelsByWorkItem,
        readTextColumn(row, 0, "work_item_id"),
        toProjectLabel(row.slice(1)),
      );
    }

    return labelsByWorkItem;
  }

  /** Assigns a project label to a work item. */
  public async assign(workItemId: string, labelId: string): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_labels (
            work_item_id,
            label_id
        )
        VALUES (
            $work_item_id,
            $label_id
        )
        ON CONFLICT (work_item_id, label_id) DO NOTHING;
      `,
      { label_id: labelId, work_item_id: workItemId },
    );
  }

  /** Removes a project label from a work item. */
  public async unassign(workItemId: string, labelId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_labels
        WHERE work_item_id = $work_item_id
            AND label_id = $label_id;
      `,
      { label_id: labelId, work_item_id: workItemId },
    );
  }

  /** Removes every label assignment from a work item. */
  public async removeAllFromWorkItem(workItemId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_labels
        WHERE work_item_id = $work_item_id;
      `,
      { work_item_id: workItemId },
    );
  }
}

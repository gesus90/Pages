import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import { createInClause } from "./InClause";
import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { Label, WorkItemVisibility } from "@/definition/Task";

/** Values required to persist a label in the global catalog. */
export interface NewLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Values that can be changed on a label. */
export interface LabelUpdate {
  readonly name: string;
  readonly color: string;
}

function toLabel(row: readonly DatabaseValue[]): Label {
  return {
    color: readTextColumn(row, 2, "color"),
    createdAt: readTextColumn(row, 3, "created_at"),
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    updatedAt: readTextColumn(row, 4, "updated_at"),
  };
}

function appendToGroup(
  groups: Map<string, Label[]>,
  groupId: string,
  label: Label,
): void {
  const group = groups.get(groupId);

  if (group) {
    group.push(label);
  } else {
    groups.set(groupId, [label]);
  }
}

/** Owns persistence operations for the global label catalog and its ticket assignments. */
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

  /** Returns the global label catalog ordered by name. */
  public async findAll(): Promise<Label[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            name,
            color,
            created_at,
            updated_at
        FROM labels
        ORDER BY name ASC;
      `,
    );

    return rows.map(toLabel);
  }

  /** Returns a label by its identifier. */
  public async findById(id: string): Promise<Label | null> {
    return this.findOne("WHERE id = $id", { id });
  }

  /** Returns the label with this name, ignoring case. */
  public async findByName(name: string): Promise<Label | null> {
    return this.findOne("WHERE lower(name) = lower($name)", { name });
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
   * Returns how many tickets use each label.
   *
   * @returns Usage counts by label id; labels without tickets are absent.
   */
  public async countUsageByLabel(
    visibility?: WorkItemVisibility,
  ): Promise<ReadonlyMap<string, number>> {
    const usage = new Map<string, number>();
    const scope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            work_item_labels.label_id,
            COUNT(*) AS usage_count
        FROM work_item_labels
        INNER JOIN work_items
            ON work_items.id = work_item_labels.work_item_id
        WHERE ${scope.condition}
        GROUP BY work_item_labels.label_id;
      `,
      scope.parameters,
    );

    for (const row of rows) {
      usage.set(
        readTextColumn(row, 0, "label_id"),
        readCountColumn(row, 1, "usage_count"),
      );
    }

    return usage;
  }

  /** Inserts a label into the global catalog. */
  public async insert(label: NewLabel): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO labels (
            id,
            name,
            color,
            created_at,
            updated_at
        )
        VALUES (
            $id,
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
      },
    );
  }

  /** Renames or recolors a label; tickets reference it by id. */
  public async update(id: string, label: LabelUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE labels
        SET
            name = $name,
            color = $color,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, name: label.name, color: label.color },
    );
  }

  /** Deletes a label and all of its ticket assignments. */
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
        DELETE FROM labels
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Returns the labels of the given work items mapped by work item id. */
  public async findByWorkItemIds(
    workItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly Label[]>> {
    const labelsByWorkItem = new Map<string, Label[]>();

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
            labels.id,
            labels.name,
            labels.color,
            labels.created_at,
            labels.updated_at
        FROM work_item_labels
        INNER JOIN labels
            ON labels.id = work_item_labels.label_id
        WHERE work_item_labels.work_item_id IN (${placeholders})
        ORDER BY labels.name ASC;
      `,
      parameters,
    );

    for (const row of rows) {
      appendToGroup(
        labelsByWorkItem,
        readTextColumn(row, 0, "work_item_id"),
        toLabel(row.slice(1)),
      );
    }

    return labelsByWorkItem;
  }

  /** Assigns a label to a work item. */
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

  /** Removes a label from a work item. */
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

  private async findOne(
    condition: string,
    parameters: Record<string, string>,
  ): Promise<Label | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            name,
            color,
            created_at,
            updated_at
        FROM labels
        ${condition};
      `,
      parameters,
    );
    const row = rows[0];

    return row ? toLabel(row) : null;
  }
}

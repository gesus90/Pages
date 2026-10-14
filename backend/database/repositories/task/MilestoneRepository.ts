import { readTextColumn } from "@/backend/database/RowValue";
import {
  isMilestoneColor,
  isMilestoneIcon,
  isMilestoneStatus,
} from "@/definition/Task";

import { createInClause } from "./InClause";
import { readOptionalTextColumn } from "./OptionalColumn";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";
import type {
  Milestone,
  MilestoneColor,
  MilestoneIcon,
  MilestoneReadOptions,
} from "@/definition/Task";

/** Values required to persist a milestone. */
export interface NewMilestone {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly startAt?: string | null;
  readonly dueAt: string | null;
  readonly colorKey?: MilestoneColor | null;
  readonly iconKey?: MilestoneIcon | null;
  readonly colorCustom?: string | null;
}

/** Values that can be changed on a milestone. */
export interface MilestoneUpdate {
  readonly name: string;
  readonly description: string;
  readonly status: "open" | "completed" | "archived";
  readonly startAt?: string | null;
  readonly dueAt: string | null;
  readonly colorKey?: MilestoneColor | null;
  readonly iconKey?: MilestoneIcon | null;
  readonly colorCustom?: string | null;
}

/** The milestone fields that can be replaced one at a time. */
export type MilestoneField =
  "name" | "description" | "status" | "startAt" | "dueAt";

/** One field with the value it must still hold and its new value. */
export interface MilestoneFieldChange {
  readonly field: MilestoneField;
  readonly base: string | null;
  readonly value: string | null;
}

/** One fixed statement per field, so no column name is ever built from input. */
const MILESTONE_FIELD_STATEMENTS: Readonly<Record<MilestoneField, string>> = {
  name: `
    UPDATE milestones
    SET
        name = $value,
        updated_at = utc_now()
    WHERE id = $id
        AND archived_at IS NULL
        AND name = $base_value
    RETURNING id;
  `,
  description: `
    UPDATE milestones
    SET
        description = $value,
        updated_at = utc_now()
    WHERE id = $id
        AND archived_at IS NULL
        AND COALESCE(description, '') = $base_value
    RETURNING id;
  `,
  status: `
    UPDATE milestones
    SET
        status = $value,
        completed_at = CASE WHEN $value = 'completed' THEN utc_now() ELSE NULL END,
        updated_at = utc_now()
    WHERE id = $id
        AND archived_at IS NULL
        AND status = $base_value
    RETURNING id;
  `,
  startAt: `
    UPDATE milestones
    SET
        start_at = $value,
        updated_at = utc_now()
    WHERE id = $id
        AND archived_at IS NULL
        AND (
            start_at = $base_value
            OR ($base_value IS NULL AND start_at IS NULL)
        )
    RETURNING id;
  `,
  dueAt: `
    UPDATE milestones
    SET
        due_at = $value,
        updated_at = utc_now()
    WHERE id = $id
        AND archived_at IS NULL
        AND (
            due_at = $base_value
            OR ($base_value IS NULL AND due_at IS NULL)
        )
    RETURNING id;
  `,
};

const CUSTOM_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function readMilestoneStatus(
  row: readonly DatabaseValue[],
): Milestone["status"] {
  const status = readTextColumn(row, 4, "status");

  return isMilestoneStatus(status) ? status : "open";
}

function readMilestoneColorKey(
  row: readonly DatabaseValue[],
): MilestoneColor | null {
  const colorKey = readOptionalTextColumn(row, 11, "color_key");

  return isMilestoneColor(colorKey) ? colorKey : null;
}

function readMilestoneIconKey(
  row: readonly DatabaseValue[],
): MilestoneIcon | null {
  const iconKey = readOptionalTextColumn(row, 12, "icon_key");

  return isMilestoneIcon(iconKey) ? iconKey : null;
}

function readMilestoneCustomColor(
  row: readonly DatabaseValue[],
): string | null {
  const customColor = readOptionalTextColumn(row, 13, "color_custom");

  if (customColor === null || !CUSTOM_COLOR_PATTERN.test(customColor)) {
    return null;
  }

  return customColor;
}

function toMilestone(row: readonly DatabaseValue[]): Milestone {
  return {
    archivedAt: readOptionalTextColumn(row, 10, "archived_at"),
    colorCustom: readMilestoneCustomColor(row),
    colorKey: readMilestoneColorKey(row),
    completedAt: readOptionalTextColumn(row, 9, "completed_at"),
    createdAt: readTextColumn(row, 7, "created_at"),
    description: readTextColumn(row, 3, "description"),
    dueAt: readOptionalTextColumn(row, 6, "due_at"),
    iconKey: readMilestoneIconKey(row),
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 2, "name"),
    projectId: readTextColumn(row, 1, "project_id"),
    startAt: readOptionalTextColumn(row, 5, "start_at"),
    status: readMilestoneStatus(row),
    updatedAt: readTextColumn(row, 8, "updated_at"),
  };
}

/** Owns persistence operations for project milestones. */
export class MilestoneRepository {
  private readonly database: TaskDatabase;

  /**
   * Creates a milestone repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: TaskDatabase) {
    this.database = database;
  }

  /** Returns all non-archived milestones for the given projects. */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<Milestone[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const { parameters, placeholders } = createInClause(
      "project_id",
      projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            COALESCE(description, ''),
            status,
            start_at,
            due_at,
            created_at,
            updated_at,
            completed_at,
            archived_at,
            color_key,
            icon_key,
            color_custom
        FROM milestones
        WHERE project_id IN (${placeholders})
            AND archived_at IS NULL
        ORDER BY due_at ASC, name ASC;
      `,
      parameters,
    );

    return rows.map(toMilestone);
  }

  /** Returns a milestone by its identifier. */
  public async findById(
    id: string,
    options: MilestoneReadOptions = {},
  ): Promise<Milestone | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            COALESCE(description, ''),
            status,
            start_at,
            due_at,
            created_at,
            updated_at,
            completed_at,
            archived_at,
            color_key,
            icon_key,
            color_custom
        FROM milestones
        WHERE id = $id
            AND ($include_archived OR archived_at IS NULL);
      `,
      { id, include_archived: options.includeArchived ?? false },
    );
    const row = rows[0];

    return row ? toMilestone(row) : null;
  }

  /** Inserts a milestone for the given project. */
  public async insert(milestone: NewMilestone): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO milestones (
            id,
            project_id,
            name,
            description,
            status,
            start_at,
            due_at,
            color_key,
            icon_key,
            color_custom,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $name,
            $description,
            'open',
            $start_at,
            $due_at,
            $color_key,
            $icon_key,
            $color_custom,
            utc_now()
        );
      `,
      {
        id: milestone.id,
        project_id: milestone.projectId,
        name: milestone.name,
        description: milestone.description,
        start_at: milestone.startAt ?? null,
        due_at: milestone.dueAt,
        color_key: milestone.colorKey ?? null,
        icon_key: milestone.iconKey ?? null,
        color_custom: milestone.colorCustom ?? null,
      },
    );
  }

  /** Updates the editable values of a milestone. */
  public async update(id: string, milestone: MilestoneUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE milestones
        SET
            name = $name,
            description = $description,
            status = $status,
            start_at = $start_at,
            due_at = $due_at,
            color_key = $color_key,
            icon_key = $icon_key,
            color_custom = $color_custom,
            completed_at = CASE WHEN $status = 'completed' THEN utc_now() ELSE NULL END,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        name: milestone.name,
        description: milestone.description,
        status: milestone.status,
        start_at: milestone.startAt ?? null,
        due_at: milestone.dueAt,
        color_key: milestone.colorKey ?? null,
        icon_key: milestone.iconKey ?? null,
        color_custom: milestone.colorCustom ?? null,
      },
    );
  }

  /**
   * Replaces one field of a milestone while it still holds the base value.
   *
   * @param id - Milestone identifier.
   * @param change - The field, the value it must still hold, and the new value.
   * @returns Whether a row changed; false when archived or the field differs.
   *
   * @remarks
   * The other fields stay as they are, so a rename does not move the
   * completion time of a completed milestone.
   */
  public async updateField(
    id: string,
    change: MilestoneFieldChange,
  ): Promise<boolean> {
    const rows = await this.database.query(
      MILESTONE_FIELD_STATEMENTS[change.field],
      { base_value: change.base, id, value: change.value },
    );

    return rows.length > 0;
  }

  /** Soft-deletes a milestone without removing its row. */
  public async archive(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE milestones
        SET
            archived_at = utc_now(),
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
  }
}

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { createInClause } from "./InClause";
import { toWorkItemDetail } from "./WorkItemDetailMapper";
import {
  createWorkItemConditionStatement,
  createWorkItemListStatement,
} from "./WorkItemDetailStatement";
import { buildWorkItemFilter } from "./WorkItemFilter";
import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { Database } from "@/backend/database/Database";
import type { WorkItemDetail, WorkItemVisibility } from "@/definition/Task";
import type { FindWorkItemsOptions } from "./WorkItemFilter";

/** Owns the read access to work items together with their joined display data. */
export class WorkItemQueryRepository {
  private readonly database: Database;

  /**
   * Creates a work item query repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns non-archived work items matching the given filters. */
  public async findAll(
    options: FindWorkItemsOptions = {},
  ): Promise<WorkItemDetail[]> {
    const filter = buildWorkItemFilter(options);

    if (!filter) {
      return [];
    }

    const rows = await this.database.query(
      createWorkItemListStatement(filter),
      filter.parameters,
    );

    return rows.map(toWorkItemDetail);
  }

  /** Returns one non-archived work item by identifier. */
  public async findById(
    id: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail | null> {
    return this.findFirstByCondition("work_items.id = $id", { id }, visibility);
  }

  /** Returns one non-archived work item by its key (e.g. PAGE-12). */
  public async findByKey(
    key: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail | null> {
    return this.findFirstByCondition(
      "work_items.key = $key",
      { key },
      visibility,
    );
  }

  /** Reads an authorized item's stored parent solely to preserve a redacted existing relation. */
  public async findParentReference(
    id: string,
  ): Promise<{ readonly id: string; readonly key: string | null } | null> {
    const rows = await this.database.query(
      `
      SELECT
          work_items.parent_id,
          parent.key
      FROM work_items
      LEFT JOIN work_items AS parent
          ON parent.id = work_items.parent_id
      WHERE work_items.id = $id
          AND work_items.parent_id IS NOT NULL;
    `,
      { id },
    );
    const row = rows[0];
    return row
      ? {
          id: readTextColumn(row, 0, "parent_id"),
          key: readNullableTextColumn(row, 1, "key"),
        }
      : null;
  }

  /** Resolves visible parent-history keys in one parameterized scope query. */
  public async findVisibleKeys(
    keys: readonly string[],
    visibility: WorkItemVisibility,
  ): Promise<ReadonlySet<string>> {
    if (keys.length === 0) return new Set();
    const scope = createWorkItemVisibility(visibility);
    const { parameters, placeholders } = createInClause("history_key", keys);
    const rows = await this.database.query(
      `
      SELECT work_items.key
      FROM work_items
      WHERE work_items.key IN (${placeholders})
          AND ${scope.condition};
    `,
      { ...parameters, ...scope.parameters },
    );
    return new Set(rows.map((row) => readTextColumn(row, 0, "key")));
  }

  /** Returns all non-archived subtasks belonging to a parent item. */
  public async findSubtasks(
    parentId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail[]> {
    return this.findByCondition(
      "work_items.parent_id = $parent_id AND work_items.archived_at IS NULL",
      { parent_id: parentId },
      visibility,
    );
  }

  /** Returns non-archived tasks of a project linked to a GitHub issue. */
  public async findLinkedWorkItems(
    projectId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail[]> {
    return this.findByCondition(
      "work_items.project_id = $project_id AND work_items.github_issue_number IS NOT NULL AND work_items.archived_at IS NULL",
      { project_id: projectId },
      visibility,
    );
  }

  /** Returns every known local GitHub issue number, including hidden and archived tickets, for classification only. */
  public async findKnownGitHubIssueNumbers(
    projectId: string,
  ): Promise<ReadonlySet<number>> {
    const rows = await this.database.query(
      `
      SELECT DISTINCT github_issue_number
      FROM work_items
      WHERE project_id = $project_id
          AND github_issue_number IS NOT NULL;
    `,
      { project_id: projectId },
    );
    return new Set(
      rows.map((row) => readCountColumn(row, 0, "github_issue_number")),
    );
  }

  private async findFirstByCondition(
    condition: string,
    parameters: Readonly<Record<string, string>>,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail | null> {
    const results = await this.findByCondition(
      condition,
      parameters,
      visibility,
    );

    return results[0] ?? null;
  }

  private async findByCondition(
    condition: string,
    parameters: Readonly<Record<string, string>>,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail[]> {
    const rows = await this.database.query(
      createWorkItemConditionStatement(condition, visibility),
      { ...parameters, ...createWorkItemVisibility(visibility).parameters },
    );

    return rows.map(toWorkItemDetail);
  }
}

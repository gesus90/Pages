import { toWorkItemDetail } from "./WorkItemDetailMapper";
import {
  createWorkItemConditionStatement,
  createWorkItemListStatement,
} from "./WorkItemDetailStatement";
import { buildWorkItemFilter } from "./WorkItemFilter";

import type { Database } from "@/backend/database/Database";
import type { WorkItemDetail } from "@/definition/Task";
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
  public async findById(id: string): Promise<WorkItemDetail | null> {
    return this.findFirstByCondition("work_items.id = $id", { id });
  }

  /** Returns one non-archived work item by its key (e.g. PAGE-12). */
  public async findByKey(key: string): Promise<WorkItemDetail | null> {
    return this.findFirstByCondition("work_items.key = $key", { key });
  }

  /** Returns all non-archived subtasks belonging to a parent item. */
  public async findSubtasks(parentId: string): Promise<WorkItemDetail[]> {
    return this.findByCondition(
      "work_items.parent_id = $parent_id AND work_items.archived_at IS NULL",
      { parent_id: parentId },
    );
  }

  /** Returns non-archived tasks of a project linked to a GitHub issue. */
  public async findLinkedWorkItems(
    projectId: string,
  ): Promise<WorkItemDetail[]> {
    return this.findByCondition(
      "work_items.project_id = $project_id AND work_items.github_issue_number IS NOT NULL AND work_items.archived_at IS NULL",
      { project_id: projectId },
    );
  }

  private async findFirstByCondition(
    condition: string,
    parameters: Readonly<Record<string, string>>,
  ): Promise<WorkItemDetail | null> {
    const results = await this.findByCondition(condition, parameters);

    return results[0] ?? null;
  }

  private async findByCondition(
    condition: string,
    parameters: Readonly<Record<string, string>>,
  ): Promise<WorkItemDetail[]> {
    const rows = await this.database.query(
      createWorkItemConditionStatement(condition),
      parameters,
    );

    return rows.map(toWorkItemDetail);
  }
}

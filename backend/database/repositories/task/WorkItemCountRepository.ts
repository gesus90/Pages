import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import { createInClause } from "./InClause";
import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { WorkItemVisibility } from "@/definition/Task";

/** Dashboard counters computed directly in the database. */
export interface WorkItemsOverview {
  readonly open: number;
  readonly overdue: number;
  readonly inProgress: number;
  readonly assigned: number;
  readonly openDelta: number;
  readonly overdueDelta: number;
}

/** Per-project done/total counters computed directly in the database. */
export interface ProjectWorkItemCounts {
  readonly done: number;
  readonly total: number;
}

/**
 * Actor and time boundaries the dashboard counters are computed for.
 *
 * @remarks
 * Day boundaries are UTC calendar dates (`YYYY-MM-DD`, matching how the
 * dashboard compares due dates); `weekAgoStart` is a full-precision lower
 * bound for the seven-day delta.
 */
export interface WorkItemsOverviewScope {
  readonly userId: string;
  readonly todayDate: string;
  readonly weekAgoStart: string;
  readonly yesterdayDate: string;
}

function createEmptyOverview(): WorkItemsOverview {
  return {
    assigned: 0,
    inProgress: 0,
    open: 0,
    openDelta: 0,
    overdue: 0,
    overdueDelta: 0,
  };
}

function toWorkItemsOverview(row: readonly DatabaseValue[]): WorkItemsOverview {
  return {
    assigned: readCountColumn(row, 3, "assigned_count"),
    inProgress: readCountColumn(row, 2, "in_progress_count"),
    open: readCountColumn(row, 0, "open_count"),
    openDelta: readCountColumn(row, 4, "open_delta_count"),
    overdue: readCountColumn(row, 1, "overdue_count"),
    overdueDelta: readCountColumn(row, 5, "overdue_delta_count"),
  };
}

function addToProjectCounts(
  countsByProject: Map<string, ProjectWorkItemCounts>,
  row: readonly DatabaseValue[],
): void {
  const projectId = readTextColumn(row, 0, "project_id");
  const isDone = readCountColumn(row, 1, "is_done") === 1;
  const count = readCountColumn(row, 2, "item_count");
  const current = countsByProject.get(projectId) ?? { done: 0, total: 0 };

  countsByProject.set(projectId, {
    done: current.done + (isDone ? count : 0),
    total: current.total + count,
  });
}

/** Owns the aggregate work item counters of dashboards and project lists. */
export class WorkItemCountRepository {
  private readonly database: Database;

  /**
   * Creates a work item count repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns dashboard counters for several projects with a single query.
   *
   * @param projectIds - Projects already verified as accessible to the actor.
   * @param scope - Actor id, day boundaries as UTC calendar dates
   * (`YYYY-MM-DD`, matching how the dashboard compares due dates), and a
   * full-precision lower bound for the seven-day delta.
   */
  public async countOverview(
    projectIds: readonly string[],
    scope: WorkItemsOverviewScope,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemsOverview> {
    if (projectIds.length === 0) {
      return createEmptyOverview();
    }

    const { parameters, placeholders } = createInClause(
      "overview_project_id",
      projectIds,
    );
    const departmentScope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            COUNT(CASE WHEN statuses.is_done = 0 THEN 1 END) AS open_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.due_at IS NOT NULL AND TRY_CAST(work_items.due_at AS DATE) <= $today_date THEN 1 END) AS overdue_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND statuses.key = 'in_progress' THEN 1 END) AS in_progress_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.assignee_id = $user_id THEN 1 END) AS assigned_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.created_at >= $week_ago_start THEN 1 END) AS open_delta_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.due_at IS NOT NULL AND TRY_CAST(work_items.due_at AS DATE) <= $today_date AND TRY_CAST(work_items.due_at AS DATE) >= $yesterday_date THEN 1 END) AS overdue_delta_count
        FROM work_items
        INNER JOIN workflow_statuses AS statuses
            ON statuses.id = work_items.status_id
        WHERE work_items.project_id IN (${placeholders})
            AND ${departmentScope.condition}
            AND work_items.archived_at IS NULL;
      `,
      {
        ...parameters,
        ...departmentScope.parameters,
        today_date: scope.todayDate,
        user_id: scope.userId,
        week_ago_start: scope.weekAgoStart,
        yesterday_date: scope.yesterdayDate,
      },
    );
    const row = rows[0];

    return row ? toWorkItemsOverview(row) : createEmptyOverview();
  }

  /**
   * Returns done/total counters per project with a single query.
   *
   * @param projectIds - Projects already verified as accessible to the actor.
   */
  public async countByProject(
    projectIds: readonly string[],
    visibility?: WorkItemVisibility,
  ): Promise<ReadonlyMap<string, ProjectWorkItemCounts>> {
    const countsByProject = new Map<string, ProjectWorkItemCounts>();

    if (projectIds.length === 0) {
      return countsByProject;
    }

    const { parameters, placeholders } = createInClause(
      "counts_project_id",
      projectIds,
    );
    const departmentScope = createWorkItemVisibility(visibility);
    const rows = await this.database.query(
      `
        SELECT
            work_items.project_id,
            statuses.is_done AS is_done,
            COUNT(*) AS item_count
        FROM work_items
        INNER JOIN workflow_statuses AS statuses
            ON statuses.id = work_items.status_id
        WHERE work_items.project_id IN (${placeholders})
            AND ${departmentScope.condition}
            AND work_items.archived_at IS NULL
        GROUP BY work_items.project_id, statuses.is_done;
      `,
      { ...parameters, ...departmentScope.parameters },
    );

    for (const row of rows) {
      addToProjectCounts(countsByProject, row);
    }

    return countsByProject;
  }
}

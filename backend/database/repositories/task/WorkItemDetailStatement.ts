import { BOARD_ORDER_CLAUSE } from "./WorkItemFilter";
import { createWorkItemVisibility } from "./WorkItemVisibility";

import type { WorkItemVisibility } from "@/definition/Task";
import type { WorkItemFilter } from "./WorkItemFilter";

/**
 * Builds the statement that selects work items with their joined display data.
 *
 * @remarks
 * The column order is the contract of `toWorkItemDetail`.
 */
function createWorkItemDetailStatement(
  subtaskScope: string,
  trailingClauses: readonly string[],
  visibility?: WorkItemVisibility,
): string {
  const parentVisibility = createWorkItemVisibility(visibility, "parent");
  const childVisibility = createWorkItemVisibility(visibility, "child");
  const parentIdColumn =
    visibility && (visibility.departmentIds !== null || visibility.projectIds)
      ? "parent.id AS parent_id"
      : "work_items.parent_id";
  return `
      SELECT
          work_items.id,
          work_items.project_id,
          work_items.key,
          work_items.number,
          work_items.type,
          ${parentIdColumn},
          work_items.title,
          work_items.description,
          work_items.status_id,
          work_items.priority,
          work_items.assignee_id,
          work_items.created_by,
          work_items.milestone_id,
          work_items.due_at,
          work_items.sort_order,
          work_items.created_at,
          work_items.updated_at,
          work_items.completed_at,
          work_items.archived_at,
          projects.name AS project_name,
          workflow_statuses.key AS status_key,
          workflow_statuses.name AS status_name,
          workflow_statuses.is_done AS is_done,
          assignee.display_name AS assignee_name,
          milestones.name AS milestone_name,
          parent.title AS parent_title,
          parent.key AS parent_key,
          COALESCE(subtasks.total, 0) AS subtask_total,
          COALESCE(subtasks.completed, 0) AS subtask_completed,
          work_items.github_issue_number,
          work_items.github_issue_url,
          work_items.github_issue_state,
          work_items.github_issue_updated_at,
          work_items.github_content_hash,
          work_items.github_conflict,
          work_items.github_last_sync_at,
          reporter.display_name AS reporter_name,
          work_items.start_at,
          work_items.github_last_error,
          work_items.department_id,
          work_items.assignee_group_id,
          assignee_group.name AS assignee_group_name
      FROM work_items
      INNER JOIN projects
          ON projects.id = work_items.project_id
      INNER JOIN workflow_statuses
          ON workflow_statuses.id = work_items.status_id
      LEFT JOIN users AS assignee
          ON assignee.id = work_items.assignee_id
      LEFT JOIN user_groups AS assignee_group
          ON assignee_group.id = work_items.assignee_group_id
      LEFT JOIN users AS reporter
          ON reporter.id = work_items.created_by
      LEFT JOIN milestones
          ON milestones.id = work_items.milestone_id
      LEFT JOIN work_items AS parent
          ON parent.id = work_items.parent_id
              AND ${parentVisibility.condition}
      LEFT JOIN (
          SELECT
              child.parent_id,
              COUNT(*) AS total,
              SUM(CASE WHEN child_status.is_done = 1 THEN 1 ELSE 0 END) AS completed
          FROM work_items AS child
          INNER JOIN workflow_statuses AS child_status
              ON child_status.id = child.status_id
          WHERE child.archived_at IS NULL
              AND ${childVisibility.condition}
          ${subtaskScope}
          GROUP BY child.parent_id
      ) AS subtasks
          ON subtasks.parent_id = work_items.id
      ${trailingClauses.join("\n      ")}
    `;
}

/**
 * Builds the statement for a filtered, ordered, and optionally limited list.
 *
 * @param filter - Fragments derived from the caller's query options.
 */
export function createWorkItemListStatement(filter: WorkItemFilter): string {
  return createWorkItemDetailStatement(
    filter.subtaskScope,
    [filter.whereClause, filter.orderClause, filter.limitClause],
    filter.visibility,
  );
}

/**
 * Builds the statement for work items matching one fixed condition, in board order.
 *
 * @param condition - Trusted SQL condition; values must be bound as parameters.
 */
export function createWorkItemConditionStatement(
  condition: string,
  visibility?: WorkItemVisibility,
): string {
  const scope = createWorkItemVisibility(visibility);
  return createWorkItemDetailStatement(
    "",
    [
      `WHERE ${condition}\n          AND ${scope.condition}`,
      `${BOARD_ORDER_CLAUSE};`,
    ],
    visibility,
  );
}

import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  isGitHubIssueState,
  isWorkItemPriority,
  isWorkItemType,
} from "@/definition/Task";

import {
  readOptionalCountColumn,
  readOptionalTextColumn,
} from "./OptionalColumn";

import type { DatabaseValue } from "@/backend/database/Database";
import type {
  GitHubIssueState,
  WorkItemDetail,
  WorkItemPriority,
  WorkItemType,
} from "@/definition/Task";

type WorkItemRow = readonly DatabaseValue[];

/** Columns stored on the work item row itself. */
type WorkItemCore = Pick<
  WorkItemDetail,
  | "archivedAt"
  | "assigneeGroupId"
  | "assigneeId"
  | "completedAt"
  | "createdAt"
  | "createdBy"
  | "departmentId"
  | "description"
  | "dueAt"
  | "id"
  | "key"
  | "milestoneId"
  | "number"
  | "parentId"
  | "priority"
  | "projectId"
  | "sortOrder"
  | "startAt"
  | "statusId"
  | "title"
  | "type"
  | "updatedAt"
>;

/** Columns that describe the linked GitHub issue. */
type WorkItemGitHubColumns = Pick<
  WorkItemDetail,
  | "githubConflict"
  | "githubContentHash"
  | "githubIssueNumber"
  | "githubIssueState"
  | "githubIssueUpdatedAt"
  | "githubIssueUrl"
  | "githubLastError"
  | "githubLastSyncAt"
>;

/** Display names and keys joined from related rows. */
type WorkItemJoinedNames = Pick<
  WorkItemDetail,
  | "assigneeGroupName"
  | "assigneeName"
  | "milestoneName"
  | "parentKey"
  | "parentTitle"
  | "projectName"
  | "reporterName"
  | "statusKey"
  | "statusName"
>;

function readWorkItemType(row: WorkItemRow): WorkItemType {
  const type = readTextColumn(row, 4, "type");

  if (!isWorkItemType(type)) {
    throw new Error(
      `Database returned an unsupported work item type "${type}".`,
    );
  }

  return type;
}

function readWorkItemPriority(row: WorkItemRow): WorkItemPriority {
  const priority = readTextColumn(row, 9, "priority");

  if (!isWorkItemPriority(priority)) {
    throw new Error(`Database returned an unsupported priority "${priority}".`);
  }

  return priority;
}

function readGitHubIssueState(row: WorkItemRow): GitHubIssueState | null {
  const issueState = row[31];

  if (issueState !== null && !isGitHubIssueState(issueState)) {
    throw new Error(
      `Database returned an unsupported GitHub issue state "${issueState}".`,
    );
  }

  return issueState;
}

function readWorkItemCore(row: WorkItemRow): WorkItemCore {
  return {
    archivedAt: readOptionalTextColumn(row, 18, "archived_at"),
    assigneeGroupId: readOptionalTextColumn(row, 40, "assignee_group_id"),
    assigneeId: readOptionalTextColumn(row, 10, "assignee_id"),
    completedAt: readOptionalTextColumn(row, 17, "completed_at"),
    createdAt: readTextColumn(row, 15, "created_at"),
    createdBy: readTextColumn(row, 11, "created_by"),
    departmentId: readOptionalTextColumn(row, 39, "department_id"),
    description: readTextColumn(row, 7, "description"),
    dueAt: readOptionalTextColumn(row, 13, "due_at"),
    id: readTextColumn(row, 0, "id"),
    key: readTextColumn(row, 2, "key"),
    milestoneId: readOptionalTextColumn(row, 12, "milestone_id"),
    number: readCountColumn(row, 3, "number"),
    parentId: readOptionalTextColumn(row, 5, "parent_id"),
    priority: readWorkItemPriority(row),
    projectId: readTextColumn(row, 1, "project_id"),
    sortOrder: readCountColumn(row, 14, "sort_order"),
    startAt: readOptionalTextColumn(row, 37, "start_at"),
    statusId: readTextColumn(row, 8, "status_id"),
    title: readTextColumn(row, 6, "title"),
    type: readWorkItemType(row),
    updatedAt: readTextColumn(row, 16, "updated_at"),
  };
}

function readWorkItemGitHubColumns(row: WorkItemRow): WorkItemGitHubColumns {
  return {
    githubConflict: readBooleanColumn(row, 34, "github_conflict"),
    githubContentHash: readOptionalTextColumn(row, 33, "github_content_hash"),
    githubIssueNumber: readOptionalCountColumn(row, 29, "github_issue_number"),
    githubIssueState: readGitHubIssueState(row),
    githubIssueUpdatedAt: readOptionalTextColumn(
      row,
      32,
      "github_issue_updated_at",
    ),
    githubIssueUrl: readOptionalTextColumn(row, 30, "github_issue_url"),
    githubLastError: readOptionalTextColumn(row, 38, "github_last_error"),
    githubLastSyncAt: readOptionalTextColumn(row, 35, "github_last_sync_at"),
  };
}

function readWorkItemJoinedNames(row: WorkItemRow): WorkItemJoinedNames {
  return {
    assigneeGroupName: readOptionalTextColumn(row, 41, "assignee_group_name"),
    assigneeName: readOptionalTextColumn(row, 23, "assignee_name"),
    milestoneName: readOptionalTextColumn(row, 24, "milestone_name"),
    parentKey: readOptionalTextColumn(row, 26, "parent_key"),
    parentTitle: readOptionalTextColumn(row, 25, "parent_title"),
    projectName: readTextColumn(row, 19, "project_name"),
    reporterName: readOptionalTextColumn(row, 36, "reporter_name"),
    statusKey: readTextColumn(row, 20, "status_key"),
    statusName: readTextColumn(row, 21, "status_name"),
  };
}

/** Subtasks decide the progress; without them a done item counts as complete. */
function calculateProgressPercentage(
  subtaskTotal: number,
  subtaskCompleted: number,
  isDone: boolean,
): number {
  if (subtaskTotal > 0) {
    return Math.round((subtaskCompleted / subtaskTotal) * 100);
  }

  return isDone ? 100 : 0;
}

/**
 * Maps a row of the work item detail statement to a work item.
 *
 * @param row - Row selected by `createWorkItemListStatement` or
 * `createWorkItemConditionStatement`.
 * @returns The work item including its joined display data.
 * @throws When the row holds an unsupported type, priority, or GitHub issue state.
 */
export function toWorkItemDetail(row: WorkItemRow): WorkItemDetail {
  const isDone = readBooleanColumn(row, 22, "is_done");
  const subtaskTotal = readCountColumn(row, 27, "subtask_total");
  const subtaskCompleted = readCountColumn(row, 28, "subtask_completed");

  return {
    ...readWorkItemCore(row),
    ...readWorkItemGitHubColumns(row),
    ...readWorkItemJoinedNames(row),
    isDone,
    progressPercentage: calculateProgressPercentage(
      subtaskTotal,
      subtaskCompleted,
      isDone,
    ),
    subtaskCompleted,
    subtaskTotal,
  };
}

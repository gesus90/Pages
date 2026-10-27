import type { Label, WorkItemDetail } from "@/definition/Task";

/** A work item as the board lists it; every field has a neutral value. */
export function workItem(
  id: string,
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    id,
    projectId: "p1",
    departmentId: null,
    key: `PAGE-${id}`,
    number: 1,
    type: "task",
    parentId: null,
    title: `Title ${id}`,
    description: "",
    statusId: "open",
    priority: "normal",
    assigneeId: null,
    assigneeGroupId: null,
    createdBy: "creator",
    milestoneId: null,
    dueAt: null,
    sortOrder: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    completedAt: null,
    archivedAt: null,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubContentHash: null,
    githubConflict: false,
    githubLastSyncAt: null,
    githubLastError: null,
    startAt: null,
    projectName: "Project",
    statusKey: "open",
    statusName: "Open",
    isDone: false,
    assigneeName: null,
    assigneeGroupName: null,
    reporterName: null,
    milestoneName: null,
    parentTitle: null,
    parentKey: null,
    subtaskTotal: 0,
    subtaskCompleted: 0,
    progressPercentage: 0,
    ...overrides,
  };
}

/** A label of the global catalog. */
export function label(id: string, name = id): Label {
  return {
    id,
    name,
    color: "#ef4444",
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
  };
}

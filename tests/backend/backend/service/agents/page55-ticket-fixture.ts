import type { User } from "@/definition/User";
import type { WorkItemDetail, WorkItemChecklistItem } from "@/definition/Task";

/** Synthetic executor; the mocked ticket boundary controls its visibility. */
export const TICKET_ACTOR: User = {
  id: "owner",
  username: "owner",
  displayName: "Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

/** Description includes nested task lists and placeholder-like text that must never be evaluated recursively. */
export const TICKET: WorkItemDetail = {
  id: "ticket-id",
  projectId: "project",
  departmentId: null,
  key: "SYN-55",
  number: 55,
  type: "task",
  parentId: null,
  title: "Synthetic review",
  description:
    "Complete description\n\n- [ ] First todo\n  - [x] Nested todo\n\nLiteral {{inside_ticket}} remains unchanged.",
  statusId: "todo",
  priority: "normal",
  assigneeId: null,
  assigneeGroupId: null,
  createdBy: "owner",
  milestoneId: null,
  dueAt: null,
  sortOrder: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
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
  projectName: "Synthetic project",
  statusKey: "todo",
  statusName: "Todo",
  isDone: false,
  assigneeName: null,
  assigneeGroupName: null,
  reporterName: "Owner",
  milestoneName: null,
  parentTitle: null,
  parentKey: null,
  subtaskTotal: 0,
  subtaskCompleted: 0,
  progressPercentage: 0,
};

/** Acceptance criteria stored separately from the description. */
export const CRITERIA: readonly WorkItemChecklistItem[] = [
  {
    id: "criterion",
    workItemId: TICKET.id,
    title: "Criterion is included in full",
    isDone: false,
    sortOrder: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
  },
];

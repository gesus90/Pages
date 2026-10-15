import type { NewWorkItemHistory } from "@/backend/database/repositories/TaskRepository";
import type { MilestoneInitiativeLink } from "@/backend/database/repositories/TaskRepository";
import type { StoredWorkItemLink } from "@/backend/database/repositories/task/WorkItemLinkRepository";
import type {
  Label,
  Milestone,
  MilestoneDependency,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { UserGroup } from "@/definition/UserGroup";

/** Fixed clock text of every synthetic record. */
export const RECORD_TIME = "2026-01-01 00:00:00";

/** Everything the synthetic ticket persistence holds. */
export interface TaskState {
  tickets: Map<string, WorkItemDetail>;
  statuses: WorkflowStatus[];
  milestones: Map<string, Milestone>;
  dependencies: MilestoneDependency[];
  initiativeLinks: MilestoneInitiativeLink[];
  labels: Map<string, Label>;
  assignedLabels: Map<string, Set<string>>;
  checklist: WorkItemChecklistItem[];
  links: StoredWorkItemLink[];
  groups: UserGroup[];
  people: User[];
  history: NewWorkItemHistory[];
  storageNames: Map<string, string[]>;
  keyPrefixes: Map<string, string>;
  counters: Map<string, number>;
  /** Names of the repository write methods that ran, in order. */
  writes: string[];
  /** Runs once right before the next conditional write, to simulate a race. */
  beforeWrite: (() => void) | null;
}

/** An empty persistence with the shared and one project-bound status. */
export function emptyTaskState(): TaskState {
  return {
    tickets: new Map(),
    statuses: [
      status("todo", "To do", 0, false),
      status("doing", "In progress", 1, false),
      status("done", "Done", 2, true),
      { ...status("beta-only", "Beta only", 3, false), projectId: "beta" },
    ],
    milestones: new Map(),
    dependencies: [],
    initiativeLinks: [],
    labels: new Map(),
    assignedLabels: new Map(),
    checklist: [],
    links: [],
    groups: [],
    people: [],
    history: [],
    storageNames: new Map(),
    keyPrefixes: new Map(),
    counters: new Map(),
    writes: [],
    beforeWrite: null,
  };
}

function status(
  id: string,
  name: string,
  position: number,
  isDone: boolean,
): WorkflowStatus {
  return { id, projectId: null, key: id, name, position, isDone };
}

/** Builds a ticket; tests override only the fields whose behavior they exercise. */
export function ticketRecord(
  id: string,
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    id,
    projectId: "alpha",
    projectName: "alpha",
    departmentId: "engineering",
    key: `ALP-${id}`,
    number: 1,
    type: "task",
    parentId: null,
    parentKey: null,
    parentTitle: null,
    title: `Title ${id}`,
    description: `Description ${id}`,
    statusId: "todo",
    statusKey: "todo",
    statusName: "To do",
    isDone: false,
    priority: "normal",
    assigneeId: null,
    assigneeName: null,
    assigneeGroupId: null,
    assigneeGroupName: null,
    createdBy: "writer",
    reporterName: "writer",
    milestoneId: null,
    milestoneName: null,
    dueAt: null,
    startAt: null,
    sortOrder: 0,
    createdAt: RECORD_TIME,
    updatedAt: RECORD_TIME,
    completedAt: null,
    archivedAt: null,
    subtaskTotal: 0,
    subtaskCompleted: 0,
    progressPercentage: 0,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubContentHash: null,
    githubConflict: false,
    githubLastSyncAt: null,
    githubLastError: null,
    ...overrides,
  };
}

/** Builds an open milestone. */
export function milestoneRecord(
  id: string,
  projectId: string,
  overrides: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    projectId,
    name: `Milestone ${id}`,
    description: "",
    status: "open",
    startAt: null,
    dueAt: null,
    colorKey: null,
    iconKey: null,
    colorCustom: null,
    createdAt: RECORD_TIME,
    updatedAt: RECORD_TIME,
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** Builds a catalog label. */
export function labelRecord(id: string, name: string): Label {
  return {
    id,
    name,
    color: "#f97316",
    createdAt: RECORD_TIME,
    updatedAt: RECORD_TIME,
  };
}

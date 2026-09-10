/** Work item types supported by the task management foundation. */
export const WORK_ITEM_TYPE = {
  INITIATIVE: "initiative",
  EPIC: "epic",
  TASK: "task",
  SUBTASK: "subtask",
} as const;

/** A type assigned to a work item. */
export type WorkItemType = (typeof WORK_ITEM_TYPE)[keyof typeof WORK_ITEM_TYPE];

/**
 * Narrows an unknown value to a supported work item type.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a valid work item type.
 */
export function isWorkItemType(value: unknown): value is WorkItemType {
  return (
    typeof value === "string" &&
    (Object.values(WORK_ITEM_TYPE) as readonly string[]).includes(value)
  );
}

/** Priority levels supported by work items. */
export const WORK_ITEM_PRIORITY = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  URGENT: "urgent",
} as const;

/** A priority assigned to a work item. */
export type WorkItemPriority =
  (typeof WORK_ITEM_PRIORITY)[keyof typeof WORK_ITEM_PRIORITY];

/**
 * Narrows an unknown value to a supported work item priority.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a valid work item priority.
 */
export function isWorkItemPriority(value: unknown): value is WorkItemPriority {
  return (
    typeof value === "string" &&
    (Object.values(WORK_ITEM_PRIORITY) as readonly string[]).includes(value)
  );
}

/** Built-in status identifiers for standard workflows. */
export const WORKFLOW_STATUS_KEY = {
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  REVIEW: "review",
  DONE: "done",
} as const;

/** A status key recognized across the kanban columns. */
export type WorkflowStatusKey =
  (typeof WORKFLOW_STATUS_KEY)[keyof typeof WORKFLOW_STATUS_KEY];

/** Remote states supported by GitHub issues. */
export const GITHUB_ISSUE_STATE = {
  OPEN: "open",
  CLOSED: "closed",
} as const;

/** A state assigned to a linked GitHub issue. */
export type GitHubIssueState =
  (typeof GITHUB_ISSUE_STATE)[keyof typeof GITHUB_ISSUE_STATE];

/**
 * Narrows an unknown value to a supported GitHub issue state.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a valid GitHub issue state.
 */
export function isGitHubIssueState(value: unknown): value is GitHubIssueState {
  return (
    typeof value === "string" &&
    (Object.values(GITHUB_ISSUE_STATE) as readonly string[]).includes(value)
  );
}

/** A workflow status column or phase. */
export interface WorkflowStatus {
  readonly id: string;
  readonly projectId: string | null;
  readonly key: string;
  readonly name: string;
  readonly position: number;
  readonly isDone: boolean;
}

/** A milestone used to group project deliverables. */
export interface Milestone {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly status: "open" | "completed" | "archived";
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}

/** A single persisted work item in SQLite. */
export interface WorkItem {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly number: number;
  readonly type: WorkItemType;
  readonly parentId: string | null;
  readonly title: string;
  readonly description: string;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  readonly assigneeId: string | null;
  readonly createdBy: string;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
  readonly githubIssueNumber: number | null;
  readonly githubIssueUrl: string | null;
  readonly githubIssueState: GitHubIssueState | null;
  readonly githubIssueUpdatedAt: string | null;
  readonly githubContentHash: string | null;
  readonly githubConflict: boolean;
  readonly githubLastSyncAt: string | null;
  readonly githubLastError: string | null;
  readonly startAt: string | null;
}

/** A single checklist entry used for ticket acceptance criteria. */
export interface WorkItemChecklistItem {
  readonly id: string;
  readonly workItemId: string;
  readonly title: string;
  readonly isDone: boolean;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Relation types supported between two work items. */
export const WORK_ITEM_LINK_TYPE = {
  BLOCKS: "blocks",
  RELATES_TO: "relates_to",
  DUPLICATES: "duplicates",
} as const;

/** A relation type stored on a work item link. */
export type WorkItemLinkType =
  (typeof WORK_ITEM_LINK_TYPE)[keyof typeof WORK_ITEM_LINK_TYPE];

/**
 * Narrows an unknown value to a supported work item link type.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a valid work item link type.
 */
export function isWorkItemLinkType(value: unknown): value is WorkItemLinkType {
  return (
    typeof value === "string" &&
    (Object.values(WORK_ITEM_LINK_TYPE) as readonly string[]).includes(value)
  );
}

/**
 * A link is stored once from the source ticket's perspective; each side
 * sees the relation from its own point of view via this direction.
 */
export type WorkItemLinkDirection = "outgoing" | "incoming";

/** A relation between the current work item and another one. */
export interface WorkItemLink {
  readonly id: string;
  readonly linkType: WorkItemLinkType;
  readonly direction: WorkItemLinkDirection;
  readonly linkedWorkItemId: string;
  readonly linkedWorkItemKey: string;
  readonly linkedWorkItemTitle: string;
  readonly linkedWorkItemStatusKey: string;
  readonly linkedWorkItemIsDone: boolean;
  readonly createdAt: string;
}

/** An entry recording a change to a work item. */
export interface WorkItemHistory {
  readonly id: string;
  readonly workItemId: string;
  readonly userId: string;
  readonly userDisplayName: string | null;
  readonly action: string;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly createdAt: string;
}

/** An enriched work item with join data for board, list, and detail views. */
export interface WorkItemDetail extends WorkItem {
  readonly projectName: string;
  readonly statusKey: string;
  readonly statusName: string;
  readonly isDone: boolean;
  readonly assigneeName: string | null;
  readonly reporterName: string | null;
  readonly milestoneName: string | null;
  readonly parentTitle: string | null;
  readonly parentKey: string | null;
  readonly subtaskTotal: number;
  readonly subtaskCompleted: number;
  readonly progressPercentage: number;
}

/** A project-wide label from the shared project label catalog. */
export interface ProjectLabel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly color: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Curated label colors shared by every surface showing labels. */
export const LABEL_COLORS = [
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#6b7280",
] as const;

/** A label color from the curated project palette. */
export type LabelColor = (typeof LABEL_COLORS)[number];

/** Default color assigned to newly created project labels. */
export const DEFAULT_LABEL_COLOR: LabelColor = "#f97316";

/**
 * Narrows an unknown value to a curated label color.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a valid label color.
 */
export function isLabelColor(value: unknown): value is LabelColor {
  return (
    typeof value === "string" &&
    (LABEL_COLORS as readonly string[]).includes(value)
  );
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Checks whether a value is a storable label color.
 *
 * @remarks
 * Presets and freely picked colors share one representation: a `#rrggbb`
 * hex code. The 3-digit shorthand is accepted for convenience and normalized
 * on write.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value can be stored as a label color.
 */
export function isHexColorCode(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

/**
 * Normalizes a hex color to lowercase `#rrggbb`.
 *
 * @param value - A value passing {@link isHexColorCode}.
 * @returns The normalized color, or `null` when the value is not a hex color.
 */
export function normalizeHexColorCode(value: unknown): string | null {
  if (!isHexColorCode(value)) {
    return null;
  }

  const digits = value.slice(1).toLowerCase();
  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;

  return `#${expanded}`;
}

/** Compact GitHub synchronization state derived from local ticket data. */
export type GitHubSyncState = "synced" | "pending" | "failed" | "unlinked";

/**
 * Derives the compact GitHub synchronization state of a ticket.
 *
 * @remarks
 * Only local SQLite values are inspected, so the state is available
 * instantly without contacting GitHub. A ticket counts as pending when
 * it changed after its last successful synchronization.
 *
 * @param item - Local ticket synchronization values.
 * @returns The compact state shown in the ticket surfaces.
 */
export function getWorkItemGitHubSyncState(item: {
  readonly githubIssueNumber: number | null;
  readonly githubConflict: boolean;
  readonly githubLastError: string | null;
  readonly githubLastSyncAt: string | null;
  readonly updatedAt: string;
}): GitHubSyncState {
  if (item.githubIssueNumber === null) {
    return "unlinked";
  }

  if (item.githubConflict || item.githubLastError !== null) {
    return "failed";
  }

  if (item.githubLastSyncAt === null) {
    return "pending";
  }

  const updatedAt = Date.parse(item.updatedAt);
  const syncedAt = Date.parse(item.githubLastSyncAt);

  if (
    Number.isNaN(updatedAt) ||
    Number.isNaN(syncedAt) ||
    updatedAt > syncedAt
  ) {
    return "pending";
  }

  return "synced";
}

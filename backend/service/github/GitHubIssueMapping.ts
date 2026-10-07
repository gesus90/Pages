import { createHash, randomUUID } from "node:crypto";

import type {
  NewWorkItemHistory,
  WorkItemGitHubLink,
  WorkItemUpdate,
} from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";

/** The GitHub issue values Pages stores as the link of a work item. */
export interface GitHubIssueSnapshot {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly updatedAt: string;
  readonly url: string | null;
}

/** The issue fields a push changes on GitHub. */
export interface GitHubIssuePatch {
  readonly title?: string;
  readonly body?: string;
  readonly state?: "open" | "closed";
}

/**
 * Hashes the synchronized triple so later runs detect real changes.
 *
 * @param title - Pages title or GitHub issue title.
 * @param description - Pages description or GitHub issue body.
 * @param isDone - Whether the Pages task is done or the issue is closed.
 * @returns Hex-encoded content hash shared by both sides.
 */
export function computeGitHubContentHash(
  title: string,
  description: string,
  isDone: boolean,
): string {
  return createHash("sha256")
    .update(`${title}\n${description}\n${isDone ? "closed" : "open"}`)
    .digest("hex");
}

/**
 * Maps a Pages completion state onto a GitHub issue state.
 *
 * @param isDone - Whether the Pages task reached a done status.
 * @returns The corresponding GitHub issue state.
 */
export function mapPagesToGitHubState(isDone: boolean): "open" | "closed" {
  return isDone ? "closed" : "open";
}

/**
 * Hashes the synchronized content of a Pages work item.
 *
 * @param item - Work item whose title, description, and completion are hashed.
 */
export function hashWorkItemContent(item: WorkItemDetail): string {
  return computeGitHubContentHash(item.title, item.description, item.isDone);
}

/**
 * Hashes the synchronized content of a GitHub issue.
 *
 * @param remote - Issue whose title, body, and state are hashed.
 */
export function hashRemoteIssueContent(remote: GitHubIssueData): string {
  return computeGitHubContentHash(
    remote.title,
    remote.body,
    remote.state === "closed",
  );
}

/**
 * Describes the issue fields that differ between a work item and its issue.
 *
 * @param item - Work item whose values should reach GitHub.
 * @param remote - Issue as it currently exists on GitHub.
 * @returns Only the differing fields; empty when both sides already match.
 */
export function buildGitHubIssuePatch(
  item: WorkItemDetail,
  remote: GitHubIssueData,
): GitHubIssuePatch {
  const nextState = mapPagesToGitHubState(item.isDone);

  return {
    ...(item.title === remote.title ? {} : { title: item.title }),
    ...(item.description === remote.body ? {} : { body: item.description }),
    ...(nextState === remote.state ? {} : { state: nextState }),
  };
}

/**
 * Tells whether a patch would leave the GitHub issue unchanged.
 *
 * @param patch - Patch built from a work item and its issue.
 */
export function isEmptyGitHubIssuePatch(patch: GitHubIssuePatch): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * Builds the stored link of a work item whose content now equals the issue.
 *
 * @param remote - Issue whose values the work item adopted.
 * @param lastSyncAt - Timestamp of the synchronization.
 */
export function buildLinkFromRemote(
  remote: GitHubIssueData,
  lastSyncAt: string,
): WorkItemGitHubLink {
  return {
    conflict: false,
    contentHash: hashRemoteIssueContent(remote),
    issueNumber: remote.number,
    issueState: remote.state,
    issueUpdatedAt: remote.updatedAt,
    issueUrl: remote.url,
    lastSyncAt,
  };
}

/**
 * Builds the stored link of a work item whose content the issue now mirrors.
 *
 * @param item - Work item whose values GitHub adopted.
 * @param issue - Issue values stored next to the content hash.
 * @param lastSyncAt - Timestamp of the synchronization.
 */
export function buildLinkFromPages(
  item: WorkItemDetail,
  issue: GitHubIssueSnapshot,
  lastSyncAt: string,
): WorkItemGitHubLink {
  return {
    conflict: false,
    contentHash: hashWorkItemContent(item),
    issueNumber: issue.number,
    issueState: issue.state,
    issueUpdatedAt: issue.updatedAt,
    issueUrl: issue.url,
    lastSyncAt,
  };
}

/**
 * Builds the history entry recording a synchronization with an issue.
 *
 * @param userId - User the synchronization is attributed to.
 * @param workItemId - Work item that was synchronized.
 * @param issueNumber - Number of the GitHub issue involved.
 */
export function buildSyncHistoryEntry(
  userId: string,
  workItemId: string,
  issueNumber: number,
): NewWorkItemHistory {
  return {
    action: "github_sync",
    field: "github",
    id: randomUUID(),
    newValue: `#${issueNumber}`,
    oldValue: null,
    userId,
    workItemId,
  };
}

/**
 * Builds the work item update that adopts the title and body of an issue.
 *
 * @param item - Work item keeping all its other values.
 * @param remote - Issue providing title and description.
 * @param statusId - Workflow status the work item moves to.
 */
export function buildWorkItemUpdateFromRemote(
  item: WorkItemDetail,
  remote: GitHubIssueData,
  statusId: string,
): WorkItemUpdate {
  return {
    assigneeGroupId: item.assigneeGroupId,
    assigneeId: item.assigneeId,
    description: remote.body,
    dueAt: item.dueAt,
    milestoneId: item.milestoneId,
    parentId: item.parentId,
    priority: item.priority,
    reporterId: item.createdBy,
    startAt: item.startAt,
    statusId,
    title: remote.title,
  };
}

/**
 * Finds the status a task returns to when it is open again.
 *
 * @param statuses - Workflow statuses to choose from.
 * @returns The backlog status, else the first status that is not done.
 */
export function findOpenWorkflowStatus(
  statuses: readonly WorkflowStatus[],
): WorkflowStatus | undefined {
  return (
    statuses.find((status) => status.key === "backlog") ??
    statuses.find((status) => !status.isDone)
  );
}

/**
 * Chooses the status a task takes when its issue state changed on GitHub.
 *
 * @param item - Work item receiving the remote state.
 * @param remote - Issue state to mirror.
 * @param statuses - Workflow statuses to choose from.
 * @returns The status after the pull; the current one when nothing changes.
 *
 * @remarks
 * GitHub cannot distinguish Pages-specific open states, so an open remote
 * issue only moves the task out of a done status.
 */
export function resolvePulledStatusId(
  item: WorkItemDetail,
  remote: GitHubIssueData,
  statuses: readonly WorkflowStatus[],
): string {
  const doneStatus = statuses.find((status) => status.isDone);
  const openStatus = findOpenWorkflowStatus(statuses);

  if (remote.state === "closed" && doneStatus && !item.isDone) {
    return doneStatus.id;
  }

  if (remote.state === "open" && item.isDone && openStatus) {
    return openStatus.id;
  }

  return item.statusId;
}

/** A GitHub issue without a Pages counterpart, awaiting triage. */
export interface GitHubExternalIssue {
  readonly id: string;
  readonly projectId: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly dismissed: boolean;
  readonly importedWorkItemId: string | null;
  readonly detectedAt: string;
  readonly updatedAt: string;
}

/** GitHub pull request metadata referenced from a Pages task. */
export interface GitHubPullRequest {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly branch: string | null;
  readonly workItemId: string | null;
  readonly workItemKey: string | null;
  readonly syncedAt: string;
}

/** Outcome counters reported after a project synchronization run. */
export interface GitHubSyncSummary {
  readonly pushed: number;
  readonly pulled: number;
  readonly created: number;
  readonly detected: number;
  readonly conflicts: number;
  readonly pullRequests: number;
}

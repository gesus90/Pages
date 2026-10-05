import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubSyncContext } from "@/backend/service/github/GitHubSyncContextLoader";
import type { ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Outcome counters accumulated while one synchronization run progresses. */
export interface GitHubSyncCounters {
  pushed: number;
  pulled: number;
  created: number;
  detected: number;
  conflicts: number;
  pullRequests: number;
}

/** What pushing or pulling one work item that is linked to a GitHub issue needs. */
export interface LinkedIssueRun {
  readonly sync: GitHubSyncContext;
  readonly actor: User;
  readonly item: WorkItemDetail;
  readonly issueNumber: number;
  readonly remote: GitHubIssueData;
  readonly summary: GitHubSyncCounters;
}

/**
 * Creates the counters of a run that has not done any work yet.
 *
 * @returns Counters with every outcome set to zero.
 */
export function createEmptySyncCounters(): GitHubSyncCounters {
  return {
    conflicts: 0,
    created: 0,
    detected: 0,
    pulled: 0,
    pullRequests: 0,
    pushed: 0,
  };
}

/**
 * Tells whether the sync direction lets Pages write to GitHub.
 *
 * @param integration - Integration whose direction is checked.
 */
export function canPushToGitHub(integration: ProjectIntegration): boolean {
  return integration.syncDirection !== "pull";
}

/**
 * Tells whether the sync direction lets Pages read from GitHub.
 *
 * @param integration - Integration whose direction is checked.
 */
export function canPullFromGitHub(integration: ProjectIntegration): boolean {
  return integration.syncDirection !== "push";
}

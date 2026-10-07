import { useTranslation } from "react-i18next";

import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";

import { GitHubDetailsConflict } from "./github-details/github-details-conflict";
import { GitHubDetailsError } from "./github-details/github-details-error";
import { GitHubDetailsFooter } from "./github-details/github-details-footer";
import { GitHubDetailsIssue } from "./github-details/github-details-issue";
import { GitHubDetailsPullRequests } from "./github-details/github-details-pull-requests";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

interface TaskGitHubDetailsProps {
  readonly task: WorkItemDetail;
  readonly pullRequests: readonly GitHubPullRequest[];
  /** Whether new tasks of the project reach GitHub without further action. */
  readonly publishesNewTasks: boolean;
  readonly isSyncing?: boolean;
}

/** Renders the detailed GitHub section of the full ticket view. */
export function TaskGitHubDetails({
  task,
  pullRequests,
  publishesNewTasks,
  isSyncing = false,
}: TaskGitHubDetailsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-4 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="select-none font-semibold text-foreground">
          {t("tasks.github.section")}
        </span>
        <GitHubSyncBadge
          githubConflict={task.githubConflict}
          githubIssueNumber={task.githubIssueNumber}
          githubLastError={task.githubLastError}
          githubLastSyncAt={task.githubLastSyncAt}
          isSyncing={isSyncing}
          updatedAt={task.updatedAt}
        />
      </div>

      <GitHubDetailsIssue publishesNewTasks={publishesNewTasks} task={task} />

      {pullRequests.length > 0 ? (
        <GitHubDetailsPullRequests pullRequests={pullRequests} />
      ) : null}

      {task.githubLastError ? (
        <GitHubDetailsError
          isSyncing={isSyncing}
          message={task.githubLastError}
          taskId={task.id}
        />
      ) : null}

      {task.githubConflict ? (
        <GitHubDetailsConflict isSyncing={isSyncing} taskId={task.id} />
      ) : null}

      <GitHubDetailsFooter isSyncing={isSyncing} task={task} />
    </div>
  );
}

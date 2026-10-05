import { useTranslation } from "react-i18next";

import { GitHubPullRequestItem } from "./github-pull-request-item";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

interface GitHubPullRequestsProps {
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly linkableTasks: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders the pull requests of a project and lets visitors assign them to tickets. */
export function GitHubPullRequests({
  pullRequests,
  linkableTasks,
  onSelectTask,
  onOpenTask,
}: GitHubPullRequestsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <h3 className="mt-5 select-none text-sm font-semibold text-foreground">
        {t("tasks.github.pullRequests")} ({pullRequests.length})
      </h3>
      {pullRequests.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {pullRequests.map((pullRequest) => (
            <GitHubPullRequestItem
              key={pullRequest.id}
              pullRequest={pullRequest}
              linkableTasks={linkableTasks}
              onSelectTask={onSelectTask}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("tasks.github.noPullRequests")}
        </p>
      )}
    </>
  );
}

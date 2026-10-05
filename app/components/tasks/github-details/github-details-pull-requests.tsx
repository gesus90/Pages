import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GitHubPullRequest } from "@/definition/GitHub";

const PULL_REQUEST_STATE_KEYS = {
  closed: "tasks.github.stateClosed",
  merged: "tasks.github.stateMerged",
  open: "tasks.github.stateOpen",
} as const;

/** Picks the translation key for the state of a pull request. */
function stateKey(pullRequest: GitHubPullRequest): string {
  if (pullRequest.merged) {
    return PULL_REQUEST_STATE_KEYS.merged;
  }

  return pullRequest.state === "closed"
    ? PULL_REQUEST_STATE_KEYS.closed
    : PULL_REQUEST_STATE_KEYS.open;
}

interface GitHubDetailsPullRequestsProps {
  readonly pullRequests: readonly GitHubPullRequest[];
}

/** Renders the pull requests linked to a ticket with their state. */
export function GitHubDetailsPullRequests({
  pullRequests,
}: GitHubDetailsPullRequestsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <span className="font-semibold text-foreground">
        {t("tasks.github.pullRequests")}
      </span>
      {pullRequests.map((pullRequest) => (
        <div
          key={pullRequest.id}
          className="flex items-center justify-between gap-2"
        >
          <a
            className="inline-flex min-w-0 items-center gap-1 font-semibold text-primary hover:underline"
            href={pullRequest.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">
              #{pullRequest.number} {pullRequest.title}
            </span>
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          </a>
          <span className="shrink-0 font-medium text-muted-foreground">
            {t(stateKey(pullRequest))}
          </span>
        </div>
      ))}
    </div>
  );
}

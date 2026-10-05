import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

interface GitHubPullRequestItemProps {
  readonly pullRequest: GitHubPullRequest;
  readonly linkableTasks: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders one pull request with its assigned ticket and the assignment form. */
export function GitHubPullRequestItem({
  pullRequest,
  linkableTasks,
  onSelectTask,
  onOpenTask,
}: GitHubPullRequestItemProps): React.ReactElement {
  const { t } = useTranslation();
  const assignedKey = pullRequest.workItemKey;

  return (
    <li className="rounded-xl bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
          #{pullRequest.number}
        </span>
        <a
          className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-primary hover:underline"
          href={pullRequest.url}
          rel="noreferrer"
          target="_blank"
        >
          {pullRequest.title}
        </a>
        {assignedKey ? (
          <button
            className="shrink-0 font-mono text-xs font-semibold text-primary hover:underline"
            onClick={() => onSelectTask(assignedKey)}
            onDoubleClick={() => onOpenTask(assignedKey)}
            type="button"
          >
            {assignedKey}
          </button>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("tasks.github.unassigned")}
          </span>
        )}
      </div>
      {linkableTasks.length > 0 ? (
        <Form className="mt-2 flex items-center gap-2" method="post">
          <input name="intent" type="hidden" value="github-assign-pr" />
          <input name="pullRequestId" type="hidden" value={pullRequest.id} />
          <label className="sr-only" htmlFor={`github-pr-${pullRequest.id}`}>
            {t("tasks.github.assignTask")}
          </label>
          <select
            className="h-8 rounded-xl bg-surface px-2 text-xs text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
            defaultValue={pullRequest.workItemId ?? ""}
            id={`github-pr-${pullRequest.id}`}
            name="workItemId"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <option value="">{t("tasks.github.assignTask")}</option>
            {linkableTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.key}: {task.title}
              </option>
            ))}
          </select>
        </Form>
      ) : null}
    </li>
  );
}

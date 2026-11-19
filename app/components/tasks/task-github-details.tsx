import { ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { Button } from "@/app/components/ui/button";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

const PULL_REQUEST_STATE_KEYS = {
  closed: "tasks.github.stateClosed",
  merged: "tasks.github.stateMerged",
  open: "tasks.github.stateOpen",
} as const;

interface TaskGitHubDetailsProps {
  readonly task: WorkItemDetail;
  readonly pullRequests: readonly GitHubPullRequest[];
  /** Whether new tasks of the project reach GitHub without further action. */
  readonly publishesNewTasks: boolean;
  readonly isSyncing?: boolean;
}

interface GitHubDetailsIssueProps {
  readonly task: WorkItemDetail;
  readonly publishesNewTasks: boolean;
}

interface GitHubDetailsPullRequestsProps {
  readonly pullRequests: readonly GitHubPullRequest[];
}

interface GitHubDetailsErrorProps {
  readonly taskId: string;
  readonly message: string;
  readonly isSyncing: boolean;
}

interface GitHubDetailsConflictProps {
  readonly taskId: string;
  readonly isSyncing: boolean;
}

interface GitHubDetailsFooterProps {
  readonly task: WorkItemDetail;
  readonly isSyncing: boolean;
}

function stateKey(pullRequest: GitHubPullRequest): string {
  if (pullRequest.merged) {
    return PULL_REQUEST_STATE_KEYS.merged;
  }

  return pullRequest.state === "closed"
    ? PULL_REQUEST_STATE_KEYS.closed
    : PULL_REQUEST_STATE_KEYS.open;
}

function GitHubDetailsIssue({
  task,
  publishesNewTasks,
}: GitHubDetailsIssueProps): React.ReactElement {
  const { t } = useTranslation();

  if (task.githubIssueNumber === null || !task.githubIssueUrl) {
    return (
      <p className="text-muted-foreground">
        {t(
          publishesNewTasks
            ? "tasks.github.noIssueHint"
            : "tasks.github.noIssue",
        )}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <a
        className="inline-flex min-w-0 items-center gap-1 font-semibold text-primary hover:underline"
        href={task.githubIssueUrl}
        rel="noreferrer"
        target="_blank"
      >
        <span className="truncate">
          {t("tasks.github.issue")} #{task.githubIssueNumber} {task.title}
        </span>
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
      <span className="shrink-0 font-medium text-muted-foreground">
        {task.githubIssueState === "closed"
          ? t("tasks.github.stateClosed")
          : t("tasks.github.stateOpen")}
      </span>
    </div>
  );
}

function GitHubDetailsPullRequests({
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

function GitHubDetailsError({
  taskId,
  message,
  isSyncing,
}: GitHubDetailsErrorProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="font-medium text-destructive">
        {t("tasks.github.syncFailed")}
      </p>
      <p className="mt-1 break-words text-muted-foreground">{message}</p>
      <Form className="mt-2" method="post">
        <input name="intent" type="hidden" value="sync-github-task" />
        <input name="id" type="hidden" value={taskId} />
        <Button className="h-8 px-3 text-xs" disabled={isSyncing} type="submit">
          {t("tasks.github.retry")}
        </Button>
      </Form>
    </div>
  );
}

function GitHubDetailsConflict({
  taskId,
  isSyncing,
}: GitHubDetailsConflictProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="font-medium text-destructive">
        {t("tasks.github.conflict")}
      </p>
      <div className="mt-2 flex gap-2">
        <Form method="post">
          <input name="intent" type="hidden" value="github-resolve-conflict" />
          <input name="id" type="hidden" value={taskId} />
          <input name="resolution" type="hidden" value="pages" />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isSyncing}
            type="submit"
          >
            {t("tasks.github.keepPages")}
          </Button>
        </Form>
        <Form method="post">
          <input name="intent" type="hidden" value="github-resolve-conflict" />
          <input name="id" type="hidden" value={taskId} />
          <input name="resolution" type="hidden" value="github" />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isSyncing}
            type="submit"
            variant="ghost"
          >
            {t("tasks.github.useGitHub")}
          </Button>
        </Form>
      </div>
    </div>
  );
}

function GitHubDetailsFooter({
  task,
  isSyncing,
}: GitHubDetailsFooterProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
      <span className="font-medium text-muted-foreground">
        {t("tasks.github.lastSync")}{" "}
        {task.githubLastSyncAt
          ? formatDateTime(task.githubLastSyncAt)
          : t("projectDetail.integrations.never")}
      </span>
      <div className="flex items-center gap-2">
        {task.githubIssueUrl ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            href={task.githubIssueUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {t("tasks.github.open")}
          </a>
        ) : null}
        {task.githubIssueNumber !== null ? (
          <Form method="post">
            <input name="intent" type="hidden" value="sync-github-task" />
            <input name="id" type="hidden" value={task.id} />
            <Button
              className="h-8 gap-1.5 px-3 text-xs"
              disabled={isSyncing}
              type="submit"
              variant="ghost"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t("tasks.github.syncNow")}
            </Button>
          </Form>
        ) : null}
      </div>
    </div>
  );
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

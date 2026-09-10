import { ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

interface TaskGitHubDetailsProps {
  readonly task: WorkItemDetail;
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly isSyncing?: boolean;
}

/** Renders the detailed GitHub section of the full ticket view. */
export function TaskGitHubDetails({
  task,
  pullRequests,
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

      {task.githubIssueNumber !== null && task.githubIssueUrl ? (
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
      ) : (
        <p className="text-muted-foreground">{t("tasks.github.noIssueHint")}</p>
      )}

      {pullRequests.length > 0 ? (
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
                {pullRequest.merged
                  ? t("tasks.github.stateMerged")
                  : pullRequest.state === "closed"
                    ? t("tasks.github.stateClosed")
                    : t("tasks.github.stateOpen")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {task.githubLastError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="font-medium text-destructive">
            {t("tasks.github.syncFailed")}
          </p>
          <p className="mt-1 break-words text-muted-foreground">
            {task.githubLastError}
          </p>
          <Form className="mt-2" method="post">
            <input name="intent" type="hidden" value="sync-github-task" />
            <input name="id" type="hidden" value={task.id} />
            <Button
              className="h-8 px-3 text-xs"
              disabled={isSyncing}
              type="submit"
            >
              {t("tasks.github.retry")}
            </Button>
          </Form>
        </div>
      ) : null}

      {task.githubConflict ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="font-medium text-destructive">
            {t("tasks.github.conflict")}
          </p>
          <div className="mt-2 flex gap-2">
            <Form method="post">
              <input
                name="intent"
                type="hidden"
                value="github-resolve-conflict"
              />
              <input name="id" type="hidden" value={task.id} />
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
              <input
                name="intent"
                type="hidden"
                value="github-resolve-conflict"
              />
              <input name="id" type="hidden" value={task.id} />
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
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
        <span className="font-medium text-muted-foreground">
          {t("tasks.github.lastSync")}{" "}
          {task.githubLastSyncAt ?? t("projectDetail.integrations.never")}
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
    </div>
  );
}

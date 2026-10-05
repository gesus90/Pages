import { ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

import type { WorkItemDetail } from "@/definition/Task";

interface GitHubDetailsFooterProps {
  readonly task: WorkItemDetail;
  readonly isSyncing: boolean;
}

/** Renders the last synchronization time with the open and sync-now actions. */
export function GitHubDetailsFooter({
  task,
  isSyncing,
}: GitHubDetailsFooterProps): React.ReactElement {
  const { t } = useTranslation();

  return (
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
  );
}

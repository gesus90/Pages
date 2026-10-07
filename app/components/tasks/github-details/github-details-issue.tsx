import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { WorkItemDetail } from "@/definition/Task";

interface GitHubDetailsIssueProps {
  readonly task: WorkItemDetail;
  /** Whether new tasks of the project reach GitHub without further action. */
  readonly publishesNewTasks: boolean;
}

/** Renders the linked GitHub issue of a ticket, or the hint that none is linked. */
export function GitHubDetailsIssue({
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

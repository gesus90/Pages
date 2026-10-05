import { useTranslation } from "react-i18next";

import { GitHubExternalIssueActions } from "./github-external-issue-actions";

import type { GitHubExternalIssue } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

interface GitHubExternalIssuesProps {
  readonly projectId: string;
  readonly externalIssues: readonly GitHubExternalIssue[];
  readonly linkableTasks: readonly WorkItemDetail[];
}

/** Renders the open GitHub issues of a project that still need triage. */
export function GitHubExternalIssues({
  projectId,
  externalIssues,
  linkableTasks,
}: GitHubExternalIssuesProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <h3 className="mt-5 select-none text-sm font-semibold text-foreground">
        {t("tasks.github.externalIssues")} ({externalIssues.length})
      </h3>
      {externalIssues.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {externalIssues.map((externalIssue) => (
            <li key={externalIssue.id} className="rounded-xl bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  #{externalIssue.issueNumber}
                </span>
                <a
                  className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-primary hover:underline"
                  href={externalIssue.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {externalIssue.title}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {externalIssue.state}
                </span>
              </div>
              <GitHubExternalIssueActions
                projectId={projectId}
                externalIssue={externalIssue}
                linkableTasks={linkableTasks}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("tasks.github.noExternalIssues")}
        </p>
      )}
    </>
  );
}

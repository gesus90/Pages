import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

import type { GitHubExternalIssue } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

interface GitHubExternalIssueActionsProps {
  readonly projectId: string;
  readonly externalIssue: GitHubExternalIssue;
  readonly linkableTasks: readonly WorkItemDetail[];
}

/** Renders the import, link and ignore forms of one open GitHub issue. */
export function GitHubExternalIssueActions({
  projectId,
  externalIssue,
  linkableTasks,
}: GitHubExternalIssueActionsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Form method="post">
        <input name="intent" type="hidden" value="github-import-issue" />
        <input name="projectId" type="hidden" value={projectId} />
        <input
          name="issueNumber"
          type="hidden"
          value={String(externalIssue.issueNumber)}
        />
        <Button className="h-8 px-3 text-xs" type="submit">
          {t("tasks.github.import")}
        </Button>
      </Form>
      {linkableTasks.length > 0 ? (
        <Form className="flex items-center gap-2" method="post">
          <input name="intent" type="hidden" value="github-link-issue" />
          <input name="externalId" type="hidden" value={externalIssue.id} />
          <label
            className="sr-only"
            htmlFor={`github-link-${externalIssue.id}`}
          >
            {t("tasks.github.linkTask")}
          </label>
          <select
            className="h-8 rounded-xl bg-surface px-2 text-xs text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
            defaultValue=""
            id={`github-link-${externalIssue.id}`}
            name="workItemId"
            required
          >
            <option value="" disabled>
              {t("tasks.github.linkTask")}
            </option>
            {linkableTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.key}: {task.title}
              </option>
            ))}
          </select>
          <Button className="h-8 px-3 text-xs" type="submit" variant="ghost">
            {t("tasks.github.link")}
          </Button>
        </Form>
      ) : null}
      <Form method="post">
        <input name="intent" type="hidden" value="github-dismiss-issue" />
        <input name="externalId" type="hidden" value={externalIssue.id} />
        <Button
          className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
          type="submit"
          variant="ghost"
        >
          {t("tasks.github.ignore")}
        </Button>
      </Form>
    </div>
  );
}

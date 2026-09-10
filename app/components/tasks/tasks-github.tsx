import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type {
  GitHubExternalIssue,
  GitHubPullRequest,
} from "@/definition/GitHub";
import type { Project, ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";

/** Synchronization state of one project for the GitHub overview. */
export interface TasksGitHubProjectState {
  readonly project: Project;
  readonly integration: ProjectIntegration | null;
  readonly externalIssues: readonly GitHubExternalIssue[];
  readonly pullRequests: readonly GitHubPullRequest[];
}

/**
 * Chooses the repository label shown in the project header.
 *
 * @param integration - Sanitized integration settings.
 * @returns The repository name, falling back to the raw address.
 */
function getRepositoryLabel(integration: ProjectIntegration): string {
  if (integration.repoName === null) {
    return integration.repoUrl;
  }

  return integration.repoName;
}

interface TasksGitHubProps {
  readonly states: readonly TasksGitHubProjectState[];
  readonly workItems: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly isSyncing?: boolean;
}

function ExternalIssueActions({
  projectId,
  externalIssue,
  linkableTasks,
}: {
  readonly projectId: string;
  readonly externalIssue: GitHubExternalIssue;
  readonly linkableTasks: readonly WorkItemDetail[];
}): React.ReactElement {
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

/** Renders per-project GitHub synchronization state, triage, and pull requests. */
export function TasksGitHub({
  states,
  workItems,
  onSelectTask,
  onOpenTask,
  isSyncing = false,
}: TasksGitHubProps): React.ReactElement {
  const { t } = useTranslation();

  if (states.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
        {t("tasks.github.noProjects")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {states.map((state) => {
        const linkableTasks = workItems.filter(
          (item) =>
            item.projectId === state.project.id &&
            item.type === WORK_ITEM_TYPE.TASK &&
            item.githubIssueNumber === null,
        );

        return (
          <section
            key={state.project.id}
            className="rounded-2xl bg-surface p-5 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">
                  {state.project.name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {state.integration?.isConnected
                    ? `${t("projectDetail.integrations.connected")} · ${getRepositoryLabel(state.integration)}`
                    : t("projectDetail.integrations.notConnected")}
                </p>
                {state.integration?.lastSyncAt ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("projectDetail.integrations.lastSync")}{" "}
                    {state.integration.lastSyncAt}
                  </p>
                ) : null}
              </div>
              {state.integration?.isConnected ? (
                <Form method="post">
                  <input
                    name="intent"
                    type="hidden"
                    value="sync-github-project"
                  />
                  <input
                    name="projectId"
                    type="hidden"
                    value={state.project.id}
                  />
                  <Button
                    className="h-8 px-3 text-xs"
                    disabled={isSyncing}
                    type="submit"
                    variant="ghost"
                  >
                    {isSyncing
                      ? t("projectDetail.integrations.testing")
                      : t("projectDetail.integrations.syncNow")}
                  </Button>
                </Form>
              ) : null}
            </div>

            <h3 className="mt-5 select-none text-sm font-semibold text-foreground">
              {t("tasks.github.externalIssues")} ({state.externalIssues.length})
            </h3>
            {state.externalIssues.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-2">
                {state.externalIssues.map((externalIssue) => (
                  <li
                    key={externalIssue.id}
                    className="rounded-xl bg-muted/40 p-3"
                  >
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
                    <ExternalIssueActions
                      projectId={state.project.id}
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

            <h3 className="mt-5 select-none text-sm font-semibold text-foreground">
              {t("tasks.github.pullRequests")} ({state.pullRequests.length})
            </h3>
            {state.pullRequests.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-2">
                {state.pullRequests.map((pullRequest) => {
                  const assignedKey = pullRequest.workItemKey;

                  return (
                    <li
                      key={pullRequest.id}
                      className="rounded-xl bg-muted/40 p-3"
                    >
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
                        <Form
                          className="mt-2 flex items-center gap-2"
                          method="post"
                        >
                          <input
                            name="intent"
                            type="hidden"
                            value="github-assign-pr"
                          />
                          <input
                            name="pullRequestId"
                            type="hidden"
                            value={pullRequest.id}
                          />
                          <label
                            className="sr-only"
                            htmlFor={`github-pr-${pullRequest.id}`}
                          >
                            {t("tasks.github.assignTask")}
                          </label>
                          <select
                            className="h-8 rounded-xl bg-surface px-2 text-xs text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            defaultValue={pullRequest.workItemId ?? ""}
                            id={`github-pr-${pullRequest.id}`}
                            name="workItemId"
                            onChange={(event) =>
                              event.currentTarget.form?.requestSubmit()
                            }
                          >
                            <option value="">
                              {t("tasks.github.assignTask")}
                            </option>
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
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("tasks.github.noPullRequests")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

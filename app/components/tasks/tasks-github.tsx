import { useTranslation } from "react-i18next";

import { GitHubProjectSection } from "./github/github-project-section";

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

interface TasksGitHubProps {
  readonly states: readonly TasksGitHubProjectState[];
  readonly workItems: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly isSyncing?: boolean;
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
      {states.map((state) => (
        <GitHubProjectSection
          key={state.project.id}
          externalIssues={state.externalIssues}
          integration={state.integration}
          isSyncing={isSyncing}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
          project={state.project}
          pullRequests={state.pullRequests}
          workItems={workItems}
        />
      ))}
    </div>
  );
}

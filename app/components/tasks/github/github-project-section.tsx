import { WORK_ITEM_TYPE } from "@/definition/Task";

import { GitHubExternalIssues } from "./github-external-issues";
import { GitHubProjectHeader } from "./github-project-header";
import { GitHubPullRequests } from "./github-pull-requests";

import type {
  GitHubExternalIssue,
  GitHubPullRequest,
} from "@/definition/GitHub";
import type { Project, ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";

interface GitHubProjectSectionProps {
  readonly project: Project;
  readonly integration: ProjectIntegration | null;
  readonly externalIssues: readonly GitHubExternalIssue[];
  readonly pullRequests: readonly GitHubPullRequest[];
  readonly workItems: readonly WorkItemDetail[];
  readonly isSyncing: boolean;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders the synchronization state, issue triage and pull requests of one project. */
export function GitHubProjectSection({
  project,
  integration,
  externalIssues,
  pullRequests,
  workItems,
  isSyncing,
  onSelectTask,
  onOpenTask,
}: GitHubProjectSectionProps): React.ReactElement {
  const linkableTasks = workItems.filter(
    (item) =>
      item.projectId === project.id &&
      item.type === WORK_ITEM_TYPE.TASK &&
      item.githubIssueNumber === null,
  );

  return (
    <section className="rounded-2xl bg-surface p-5 shadow-card">
      <GitHubProjectHeader
        integration={integration}
        isSyncing={isSyncing}
        project={project}
      />
      <GitHubExternalIssues
        externalIssues={externalIssues}
        linkableTasks={linkableTasks}
        projectId={project.id}
      />
      <GitHubPullRequests
        linkableTasks={linkableTasks}
        onOpenTask={onOpenTask}
        onSelectTask={onSelectTask}
        pullRequests={pullRequests}
      />
    </section>
  );
}

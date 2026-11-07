import type { ProjectDeletionScope } from "@/definition/AgentProjectDeletion";
import type { GitHubSyncSummary } from "@/definition/GitHub";
import type {
  GitHubSyncInterval,
  ProjectRole,
  ProjectStatus,
} from "@/definition/Project";

/** A person as the project API names them: by username, never by internal id. */
export interface McpProjectPerson {
  readonly username: string;
  readonly displayName: string;
}

/** A value the API names by id and name: a department or a template. */
export interface McpProjectNamed {
  readonly id: string;
  readonly name: string;
}

/** A project of the overview and of an archive question. */
export interface McpProjectSummary extends McpProjectNamed {
  readonly status: ProjectStatus;
}

/** A member of the project team with the role in the project. */
export interface McpProjectMember extends McpProjectPerson {
  readonly role: ProjectRole;
}

/** A goal of the project. */
export interface McpProjectGoal {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
}

/** A planning date of the project. */
export interface McpProjectEvent {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly date: string;
  readonly time: string | null;
  readonly type: string;
}

/** The GitHub settings of a project; the token itself never leaves the server. */
export interface McpProjectGitHub {
  readonly repoUrl: string;
  readonly hasToken: boolean;
  readonly syncIssues: boolean;
  readonly syncStatus: boolean;
  readonly syncComments: boolean;
  readonly syncPullRequests: boolean;
  readonly syncCommits: boolean;
  readonly syncDirection: "bidirectional" | "push" | "pull";
  readonly syncIntervalMinutes: GitHubSyncInterval;
  readonly syncEnabled: boolean;
  readonly isConnected: boolean;
  readonly lastSyncAt: string | null;
}

/**
 * The answer object "Projekt" of the interface (PAGE-244).
 *
 * @remarks
 * A projection of its own: no internal column and never the GitHub token.
 */
export interface McpProject {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly archived: boolean;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly notes: string;
  readonly manager: McpProjectPerson | null;
  readonly departments: readonly McpProjectNamed[];
  readonly tags: readonly string[];
  readonly members: readonly McpProjectMember[];
  readonly goals: readonly McpProjectGoal[];
  readonly events: readonly McpProjectEvent[];
  readonly hasIcon: boolean;
  readonly github: McpProjectGitHub | null;
}

/** The answer of every change that returns the current project. */
export interface McpProjectAnswer {
  readonly project: McpProject;
}

/** `GET /projects`: the projects, templates and departments the account may see. */
export interface McpProjectOverview {
  readonly projects: readonly McpProjectSummary[];
  readonly templates: readonly McpProjectNamed[];
  readonly departments: readonly McpProjectNamed[];
}

/** `POST /projects/{id}/github/test`. */
export interface McpProjectConnectionAnswer extends McpProjectAnswer {
  readonly isConnected: boolean;
}

/** `POST /projects/{id}/github/sync`. */
export interface McpProjectSyncAnswer extends McpProjectAnswer {
  readonly summary: GitHubSyncSummary;
}

/** The question of an unconfirmed archive; nothing changed. */
export interface McpProjectArchiveQuestion {
  readonly confirmationRequired: true;
  readonly project: McpProjectSummary;
}

/** The question of an unconfirmed permanent deletion; nothing changed. */
export interface McpProjectDeletionQuestion {
  readonly confirmationRequired: true;
  readonly scope: ProjectDeletionScope;
}

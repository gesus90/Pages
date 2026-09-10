/** Status values supported by project planning and tracking. */
export const PROJECT_STATUS = {
  PLANNED: "planned",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
} as const;

/** A status assigned to a project. */
export type ProjectStatus =
  (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

/** A project exposed to the project overview and detail panel. */
export interface Project {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly progress: number;
  readonly placeholderColor: string;
  readonly hasIcon: boolean;
  readonly managerId: string | null;
  readonly managerName: string | null;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Narrows an unknown value to a supported project status. */
export function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (Object.values(PROJECT_STATUS) as readonly string[]).includes(value)
  );
}

/** Project-level roles for team members within a single project. */
export const PROJECT_ROLE = {
  MANAGER: "manager",
  MEMBER: "member",
  VIEWER: "viewer",
} as const;

/** A role assigned to a person within one project. */
export type ProjectRole = (typeof PROJECT_ROLE)[keyof typeof PROJECT_ROLE];

/** Narrows an unknown value to a supported project role. */
export function isProjectRole(value: unknown): value is ProjectRole {
  return (
    typeof value === "string" &&
    (Object.values(PROJECT_ROLE) as readonly string[]).includes(value)
  );
}

/** A person assigned to a project with a project-level role. */
export interface ProjectMember {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly projectRole: ProjectRole;
  readonly joinedAt: string;
  /**
   * Whether the underlying user account is active.
   *
   * @remarks
   * Optional because older snapshots may omit it; consumers treat a missing
   * value as active. The team overview renders inactive accounts as invited
   * since they cannot sign in yet.
   */
  readonly isActive?: boolean;
}

/** A goal tracked on the project overview tab. */
export interface ProjectGoal {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly isDone: boolean;
  readonly position: number;
}

/** A planning date stored per project for later calendar use. */
export interface ProjectEvent {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly eventDate: string;
  readonly eventTime: string | null;
  readonly type: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Refresh intervals supported by the GitHub synchronization scheduler. */
export const GITHUB_SYNC_INTERVAL = {
  MANUAL: 0,
  EVERY_5_MINUTES: 5,
  EVERY_15_MINUTES: 15,
  EVERY_30_MINUTES: 30,
  EVERY_60_MINUTES: 60,
} as const;

/** A refresh interval for GitHub synchronization in minutes, `0` means manual. */
export type GitHubSyncInterval =
  (typeof GITHUB_SYNC_INTERVAL)[keyof typeof GITHUB_SYNC_INTERVAL];

/** Narrows an unknown value to a supported GitHub sync interval. */
export function isGitHubSyncInterval(
  value: unknown,
): value is GitHubSyncInterval {
  return (
    typeof value === "number" &&
    (Object.values(GITHUB_SYNC_INTERVAL) as readonly number[]).includes(value)
  );
}

/** GitHub integration settings without ever exposing the stored secret. */
export interface ProjectIntegration {
  readonly projectId: string;
  readonly repoUrl: string;
  readonly hasToken: boolean;
  readonly syncIssues: boolean;
  readonly syncStatus: boolean;
  readonly syncComments: boolean;
  readonly syncPullRequests: boolean;
  readonly syncCommits: boolean;
  readonly syncDirection: "bidirectional" | "push" | "pull";
  readonly syncIntervalMinutes: GitHubSyncInterval;
  readonly isConnected: boolean;
  readonly repoName: string | null;
  readonly lastSyncAt: string | null;
  readonly nextSyncAt: string | null;
  readonly updatedAt: string;
}

/** Categories available for filtering the project activity log. */
export const PROJECT_ACTIVITY_CATEGORY = {
  TASKS: "tasks",
  PLANNING: "planning",
  TEAM: "team",
  INTEGRATIONS: "integrations",
  PROJECT: "project",
} as const;

/** A category grouping entries of the project activity log. */
export type ProjectActivityCategory =
  (typeof PROJECT_ACTIVITY_CATEGORY)[keyof typeof PROJECT_ACTIVITY_CATEGORY];

/** A single chronological entry of the project activity log. */
export interface ProjectActivity {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly userDisplayName: string | null;
  readonly category: ProjectActivityCategory;
  readonly action: string;
  readonly message: string;
  readonly createdAt: string;
}

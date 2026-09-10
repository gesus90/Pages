import { createHash, randomUUID } from "node:crypto";

import { PERMISSION } from "@/definition/Role";
import { isGitHubSyncInterval, isProjectRole } from "@/definition/Project";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import {
  CACHE_TTLS,
  ServerCache,
  stableIdKey,
} from "@/backend/cache/ServerCache";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type {
  NewProject,
  NewProjectActivity,
  NewProjectEvent,
  NewProjectGoal,
  NewProjectIntegration,
  ProjectDetailsUpdate,
  ProjectEventUpdate,
  ProjectIcon,
  ProjectRepository,
  ProjectUpdate,
} from "@/backend/database/repositories/ProjectRepository";
import type {
  GitHubSyncInterval,
  Project,
  ProjectActivity,
  ProjectActivityCategory,
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
  ProjectRole,
} from "@/definition/Project";
import type { User } from "@/definition/User";

/** Thrown when a project does not exist or has already been archived. */
export class ProjectNotFoundError extends Error {
  public constructor() {
    super("The requested project does not exist.");
  }
}

/** Thrown when an actor may not read a project they are not assigned to. */
export class ProjectAccessDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to access the requested project.");
  }
}

/** Thrown when an actor may not create or change projects. */
export class ProjectManagementDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to manage projects.");
  }
}

/** Establishes the business-logic boundary for projects. */
export class ProjectService {
  private readonly projectRepository: ProjectRepository;
  private readonly permissionService: PermissionService;
  private readonly tokenKey: Buffer | null;
  private readonly cache: ServerCache;

  /**
   * Creates a project service.
   *
   * @param projectRepository - Project persistence boundary.
   * @param permissionService - Role and permission authorization boundary.
   * @param tokenKey - Server-side key encrypting GitHub tokens, when sync is used.
   * @param cache - Shared server cache, disabled by default for test isolation.
   */
  public constructor(
    projectRepository: ProjectRepository,
    permissionService: PermissionService,
    tokenKey: Buffer | null = null,
    cache: ServerCache = ServerCache.disabled(),
  ) {
    this.projectRepository = projectRepository;
    this.permissionService = permissionService;
    this.tokenKey = tokenKey;
    this.cache = cache;
  }

  /** Returns every non-archived project that the actor may access. */
  public async findAll(actor: User): Promise<Project[]> {
    const cacheKey = `projects:list:u:${actor.id}`;
    const cached = this.cache.get<Project[]>(cacheKey);

    if (cached) {
      return cached;
    }

    let projects: Project[];

    if (this.canManageProjects(actor)) {
      projects = await this.projectRepository.findAll();
    } else if (
      !this.permissionService.hasPermission(
        actor.role,
        PERMISSION.PARTICIPATE_IN_PROJECTS,
      )
    ) {
      throw new ProjectAccessDeniedError();
    } else {
      projects = await this.projectRepository.findByMemberId(actor.id);
    }

    this.cache.set(cacheKey, projects, CACHE_TTLS.projectsList);

    return projects;
  }

  /** Returns one project after applying project-level access rules. */
  public async getById(actor: User, projectId: string): Promise<Project> {
    const cacheKey = `project:${projectId}`;
    const cached = this.cache.get<Project>(cacheKey);
    const project =
      cached ?? (await this.projectRepository.findById(projectId));

    if (!project) {
      throw new ProjectNotFoundError();
    }

    this.cache.set(cacheKey, project, CACHE_TTLS.project);

    if (this.canManageProjects(actor)) {
      return project;
    }

    if (
      !this.permissionService.hasPermission(
        actor.role,
        PERMISSION.PARTICIPATE_IN_PROJECTS,
      ) ||
      !(await this.projectRepository.isMember(projectId, actor.id))
    ) {
      throw new ProjectAccessDeniedError();
    }

    return project;
  }

  /** Creates a project owned by the authorized actor. */
  public async create(actor: User, project: NewProject): Promise<void> {
    this.requireProjectManagement(actor);
    await this.projectRepository.insert(project);
    this.cache.invalidateProjectsList();
  }

  /** Updates a project after verifying management permission and its existence. */
  public async update(
    actor: User,
    projectId: string,
    project: ProjectUpdate,
  ): Promise<void> {
    this.requireProjectManagement(actor);
    await this.getById(actor, projectId);
    await this.projectRepository.update(projectId, project);
    this.cache.invalidateProject(projectId);
  }

  /** Archives a project without deleting it. */
  public async archive(actor: User, projectId: string): Promise<void> {
    this.requireProjectManagement(actor);
    await this.getById(actor, projectId);
    await this.projectRepository.archive(projectId);
    this.cache.invalidateProject(projectId);
  }

  /** Returns a stored icon after applying project-level access rules. */
  public async getIcon(
    actor: User,
    projectId: string,
  ): Promise<ProjectIcon | null> {
    await this.getById(actor, projectId);
    return this.projectRepository.findIconByProjectId(projectId);
  }

  /** Replaces the stored icon after applying project management rules. */
  public async replaceIcon(
    actor: User,
    projectId: string,
    icon: ProjectIcon,
  ): Promise<void> {
    this.requireProjectManagement(actor);
    await this.getById(actor, projectId);
    await this.projectRepository.upsertIcon(projectId, icon);
    this.cache.invalidateProject(projectId);
  }

  /** Returns whether the actor is allowed to create and edit projects. */
  public canManageProjects(actor: User): boolean {
    return this.permissionService.hasPermission(
      actor.role,
      PERMISSION.MANAGE_PROJECTS,
    );
  }

  /** Updates the extended detail values of a project and records the change. */
  public async updateDetails(
    actor: User,
    projectId: string,
    update: ProjectDetailsUpdate,
  ): Promise<Project> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const name = update.name.trim();
    const notes = update.notes.trim();

    if (!name || name.length > 200) {
      throw new Error("Project name must be between 1 and 200 characters.");
    }

    if (notes.length > 10_000) {
      throw new Error("Project notes must not exceed 10,000 characters.");
    }

    if (update.managerId) {
      const members = await this.projectRepository.findMembers(projectId);

      if (!members.some((member) => member.userId === update.managerId)) {
        throw new Error("The project manager must be a member of the project.");
      }
    }

    await this.projectRepository.updateDetails(projectId, {
      ...update,
      name,
      notes,
    });
    this.cache.invalidateProject(projectId);
    await this.recordActivity(
      actor,
      projectId,
      "project",
      "project_updated",
      `Project details were updated.`,
    );

    const updated = await this.projectRepository.findById(projectId);

    if (!updated) {
      throw new ProjectNotFoundError();
    }

    return updated;
  }

  /** Returns every person assigned to the project. */
  public async findMembers(
    actor: User,
    projectId: string,
  ): Promise<ProjectMember[]> {
    await this.getById(actor, projectId);

    return this.projectRepository.findMembers(projectId);
  }

  /** Adds a person to the project and records the change. */
  public async addMember(
    actor: User,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    if (!isProjectRole(role)) {
      throw new Error("Unsupported project role.");
    }

    await this.projectRepository.addMember(projectId, userId, role);
    this.cache.invalidateProjectMembership();
    await this.recordActivity(
      actor,
      projectId,
      "team",
      "member_added",
      `A person was added to the project as ${role}.`,
    );
  }

  /** Changes the project role of an assigned person. */
  public async updateMemberRole(
    actor: User,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    if (!isProjectRole(role)) {
      throw new Error("Unsupported project role.");
    }

    await this.projectRepository.updateMemberRole(projectId, userId, role);
    this.cache.invalidateProjectMembership();
    await this.recordActivity(
      actor,
      projectId,
      "team",
      "role_changed",
      `A project role was changed to ${role}.`,
    );
  }

  /** Removes a person from the project. */
  public async removeMember(
    actor: User,
    projectId: string,
    userId: string,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);
    await this.projectRepository.removeMember(projectId, userId);
    this.cache.invalidateProjectMembership();
    await this.recordActivity(
      actor,
      projectId,
      "team",
      "member_removed",
      `A person was removed from the project.`,
    );
  }

  /** Returns whether the actor may write in the project context. */
  public async canWriteProject(
    actor: User,
    projectId: string,
  ): Promise<boolean> {
    if (this.canManageProjects(actor)) {
      return true;
    }

    return this.projectRepository.isProjectManager(projectId, actor.id);
  }

  /** Returns the goals of a project. */
  public async findGoals(
    actor: User,
    projectId: string,
  ): Promise<ProjectGoal[]> {
    await this.getById(actor, projectId);

    return this.projectRepository.findGoals(projectId);
  }

  /** Creates a goal and records the change. */
  public async createGoal(
    actor: User,
    projectId: string,
    title: string,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const trimmed = title.trim();

    if (!trimmed || trimmed.length > 200) {
      throw new Error("Goal title must be between 1 and 200 characters.");
    }

    const existing = await this.projectRepository.findGoals(projectId);
    const goal: NewProjectGoal = {
      id: randomUUID(),
      projectId,
      title: trimmed,
      position: existing.length,
    };

    await this.projectRepository.insertGoal(goal);
    await this.recordActivity(
      actor,
      projectId,
      "planning",
      "goal_created",
      `Goal "${trimmed}" was created.`,
    );
  }

  /** Updates a goal. */
  public async updateGoal(
    actor: User,
    projectId: string,
    goalId: string,
    title: string,
    isDone: boolean,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const trimmed = title.trim();

    if (!trimmed || trimmed.length > 200) {
      throw new Error("Goal title must be between 1 and 200 characters.");
    }

    await this.projectRepository.updateGoal(goalId, trimmed, isDone);
  }

  /** Deletes a goal. */
  public async deleteGoal(
    actor: User,
    projectId: string,
    goalId: string,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);
    await this.projectRepository.deleteGoal(goalId);
  }

  /** Returns the tags assigned to the project. */
  public async findTags(actor: User, projectId: string): Promise<string[]> {
    await this.getById(actor, projectId);

    return this.projectRepository.findTags(projectId);
  }

  /** Replaces all tags assigned to the project. */
  public async setTags(
    actor: User,
    projectId: string,
    tags: readonly string[],
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const cleaned = tags
      .map((tag) => tag.trim().slice(0, 40))
      .filter((tag) => tag.length > 0)
      .slice(0, 20);

    await this.projectRepository.setTags(projectId, [...new Set(cleaned)]);
  }

  /** Returns the planning dates of a project. */
  public async findEvents(
    actor: User,
    projectId: string,
  ): Promise<ProjectEvent[]> {
    await this.getById(actor, projectId);

    return this.projectRepository.findEvents(projectId);
  }

  /** Creates a planning date and records the change. */
  public async createEvent(
    actor: User,
    projectId: string,
    event: Omit<NewProjectEvent, "id" | "projectId">,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const title = event.title.trim();

    if (!title || title.length > 200) {
      throw new Error("Event title must be between 1 and 200 characters.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)) {
      throw new Error("Event date must use the format YYYY-MM-DD.");
    }

    await this.projectRepository.insertEvent({
      description: event.description.trim(),
      eventDate: event.eventDate,
      eventTime: event.eventTime?.trim() || null,
      id: randomUUID(),
      projectId,
      title,
      type: event.type.trim().slice(0, 40) || "general",
    });
    await this.recordActivity(
      actor,
      projectId,
      "planning",
      "event_created",
      `Date "${title}" was created for ${event.eventDate}.`,
    );
  }

  /** Updates a planning date. */
  public async updateEvent(
    actor: User,
    projectId: string,
    eventId: string,
    event: ProjectEventUpdate,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const title = event.title.trim();

    if (!title || title.length > 200) {
      throw new Error("Event title must be between 1 and 200 characters.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)) {
      throw new Error("Event date must use the format YYYY-MM-DD.");
    }

    await this.projectRepository.updateEvent(eventId, {
      description: event.description.trim(),
      eventDate: event.eventDate,
      eventTime: event.eventTime?.trim() || null,
      title,
      type: event.type.trim().slice(0, 40) || "general",
    });
  }

  /** Archives a planning date. */
  public async archiveEvent(
    actor: User,
    projectId: string,
    eventId: string,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);
    await this.projectRepository.archiveEvent(eventId);
  }

  /** Returns the sanitized GitHub integration settings. */
  public async findIntegration(
    actor: User,
    projectId: string,
  ): Promise<ProjectIntegration | null> {
    await this.getById(actor, projectId);

    return this.projectRepository.findIntegration(projectId);
  }

  /**
   * Returns GitHub integrations for already access-checked projects.
   *
   * @remarks
   * Callers must only pass project ids the actor may access (the tasks
   * overview passes its already filtered project list).
   */
  public async findIntegrationsByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectIntegration>> {
    const cacheKey = `github:integrations:${stableIdKey(projectIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, ProjectIntegration>>(cacheKey);

    if (cached) {
      return cached;
    }

    const integrations =
      await this.projectRepository.findIntegrationsByProjectIds(projectIds);
    this.cache.set(cacheKey, integrations, CACHE_TTLS.github);

    return integrations;
  }

  /**
   * Saves the GitHub integration without ever persisting or returning the plain secret.
   *
   * @param actor - User performing the change.
   * @param projectId - Project the integration belongs to.
   * @param input - Settings from the integration form; an empty token keeps the stored secret.
   */
  public async saveIntegration(
    actor: User,
    projectId: string,
    input: {
      readonly repoUrl: string;
      readonly token: string;
      readonly syncIssues: boolean;
      readonly syncStatus: boolean;
      readonly syncComments: boolean;
      readonly syncPullRequests: boolean;
      readonly syncCommits: boolean;
      readonly syncDirection: "bidirectional" | "push" | "pull";
      readonly syncIntervalMinutes: GitHubSyncInterval;
    },
  ): Promise<ProjectIntegration | null> {
    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);

    const repoUrl = input.repoUrl.trim();

    if (
      repoUrl &&
      !/^https:\/\/github\.com\/[^/]+\/[^/]+(\.git)?\/?$/.test(repoUrl)
    ) {
      throw new Error(
        "Repository address must look like https://github.com/user/pages.git.",
      );
    }

    if (!isGitHubSyncInterval(input.syncIntervalMinutes)) {
      throw new Error("Sync interval must be 0, 5, 15, 30, or 60 minutes.");
    }

    const token = input.token.trim();
    const tokenHash = token ? hashIntegrationToken(token) : null;
    const tokenEncrypted = token ? this.encryptToken(token) : null;
    const repoName = extractRepoName(repoUrl);

    const integration: NewProjectIntegration = {
      isConnected: false,
      lastSyncAt: null,
      repoName,
      repoUrl,
      syncComments: input.syncComments,
      syncCommits: input.syncCommits,
      syncDirection: input.syncDirection,
      syncIntervalMinutes: input.syncIntervalMinutes,
      syncIssues: input.syncIssues,
      syncPullRequests: input.syncPullRequests,
      syncStatus: input.syncStatus,
      tokenEncrypted,
      tokenHash,
    };

    await this.projectRepository.upsertIntegration(projectId, integration);
    this.cache.invalidateGitHub();
    await this.recordActivity(
      actor,
      projectId,
      "integrations",
      "integration_saved",
      `GitHub integration settings were saved.`,
    );

    return this.projectRepository.findIntegration(projectId);
  }

  /** Removes the integration including the stored secret hash. */
  public async disconnectIntegration(
    actor: User,
    projectId: string,
  ): Promise<void> {
    await this.requireProjectWrite(actor, projectId);
    await this.projectRepository.deleteIntegration(projectId);
    this.cache.invalidateGitHub();
    await this.recordActivity(
      actor,
      projectId,
      "integrations",
      "integration_disconnected",
      `GitHub connection was removed.`,
    );
  }

  /** Returns the chronological activity log of a project. */
  public async findActivity(
    actor: User,
    projectId: string,
  ): Promise<ProjectActivity[]> {
    await this.getById(actor, projectId);

    return this.projectRepository.findActivity(projectId);
  }

  private requireProjectManagement(actor: User): void {
    if (!this.canManageProjects(actor)) {
      throw new ProjectManagementDeniedError();
    }
  }

  private async requireProjectWrite(
    actor: User,
    projectId: string,
  ): Promise<void> {
    if (this.canManageProjects(actor)) {
      return;
    }

    if (await this.projectRepository.isProjectManager(projectId, actor.id)) {
      return;
    }

    throw new ProjectManagementDeniedError();
  }

  /**
   * Encrypts a freshly provided token for storage.
   *
   * @param token - Plain token received from the browser.
   * @returns Encrypted payload persisted in the database.
   */
  private encryptToken(token: string): string {
    if (!this.tokenKey) {
      throw new Error(
        "GitHub synchronization is not configured on this server.",
      );
    }

    return encryptGitHubToken(token, this.tokenKey);
  }

  private async recordActivity(
    actor: User,
    projectId: string,
    category: ProjectActivityCategory,
    action: string,
    message: string,
  ): Promise<void> {
    const entry: NewProjectActivity = {
      action,
      category,
      id: randomUUID(),
      message,
      projectId,
      userId: actor.id,
    };

    await this.projectRepository.insertActivity(entry);
  }
}

/**
 * Hashes an integration token so only the hash is persisted server-side.
 *
 * @param token - Plain token received from the browser, never stored directly.
 * @returns Hex-encoded SHA-256 hash of the token.
 */
export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function extractRepoName(repoUrl: string): string | null {
  const match = repoUrl.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/,
  );

  return match?.[1] ?? null;
}

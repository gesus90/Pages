import { createHash, randomUUID } from "node:crypto";

import {
  CACHE_TTLS,
  ServerCache,
  stableIdKey,
} from "@/backend/cache/ServerCache";
import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { CAPABILITY } from "@/definition/Authorization";
import { isGitHubSyncInterval, isProjectRole } from "@/definition/Project";

import { ProjectCreationService } from "./project/ProjectCreationService";
import { ProjectAccessService } from "./project/ProjectAccessService";
import { ProjectManagementService } from "./project/ProjectManagementService";
import { ProjectTemplateService } from "./project/ProjectTemplateService";

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
  ArchivedProject,
  Project,
  ProjectActionPermissions,
  ProjectDepartmentChoices,
  ProjectActivity,
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
  ProjectRole,
  ProjectTemplate,
} from "@/definition/Project";
import type { WorkItemVisibility } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Establishes the business-logic boundary for projects. */
export class ProjectService {
  private readonly projectRepository: ProjectRepository;
  private readonly permissionService: PermissionService;
  private readonly tokenKey: Buffer | null;
  private readonly cache: ServerCache;
  private readonly creation: ProjectCreationService;
  private readonly access: ProjectAccessService;
  private readonly management: ProjectManagementService;
  private readonly templates: ProjectTemplateService;

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
    this.creation = new ProjectCreationService(projectRepository, cache);
    this.access = new ProjectAccessService(projectRepository, cache);
    this.management = new ProjectManagementService(projectRepository, cache);
    this.templates = new ProjectTemplateService(projectRepository, cache);
  }

  /** Returns every non-archived project that the actor may access. */
  public async findAll(actor: User): Promise<Project[]> {
    return this.access.findAll(actor);
  }

  /** Returns one project after applying project-level access rules. */
  public async getById(actor: User, projectId: string): Promise<Project> {
    return this.access.getById(actor, projectId);
  }

  /** Creates a project owned by the authorized actor and returns its read grant. */
  public async create(actor: User, project: NewProject): Promise<boolean> {
    return this.creation.create(actor, project);
  }

  /** Returns the department choices allowed by the current account's project scope. */
  public async departmentChoices(
    actor: User,
  ): Promise<ProjectDepartmentChoices> {
    return this.creation.choices(actor);
  }

  /** Returns the current server-only ticket visibility within accessible active projects. */
  public async workItemVisibility(actor: User): Promise<WorkItemVisibility> {
    return (await this.access.scope(actor)).visibility;
  }

  /** Filters backend candidate catalogs by each user's current project read access. */
  public async filterAssignees(
    candidates: ReadonlyMap<string, readonly User[]>,
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    return this.access.filterAssignees(candidates);
  }

  /** Returns current per-project action hints. */
  public async permissions(
    actor: User,
    projectId: string,
  ): Promise<ProjectActionPermissions> {
    return this.management.permissions(actor, projectId);
  }

  /** Changes assignments after complete current scope validation. */
  public async setDepartments(
    actor: User,
    projectId: string,
    departmentIds: readonly string[],
  ): Promise<void> {
    await this.management.setDepartments(actor, projectId, departmentIds);
  }

  /** Returns archive metadata accessible to the current account. */
  public async findArchived(actor: User): Promise<ArchivedProject[]> {
    return this.management.findArchived(actor);
  }

  /** Returns the current administrator-mode hint for archive deletion controls. */
  public async canDeleteProjects(actor: User): Promise<boolean> {
    return this.management.canDelete(actor);
  }

  /** Returns reusable snapshots with current access to their source projects. */
  public async findTemplates(actor: User): Promise<ProjectTemplate[]> {
    return this.templates.findAll(actor);
  }

  /** Saves or refreshes the general project snapshot available as a template. */
  public async saveTemplate(actor: User, projectId: string): Promise<void> {
    await this.templates.save(actor, projectId);
  }

  /** Creates from an accessible template with explicit assignments and returns its read grant. */
  public async createFromTemplate(
    actor: User,
    templateId: string,
    input: NewProject,
  ): Promise<boolean> {
    return this.templates.create(actor, templateId, input);
  }

  /** Permanently removes the complete project aggregate in administrator mode. */
  public async deletePermanently(
    actor: User,
    projectId: string,
  ): Promise<void> {
    await this.management.deletePermanently(actor, projectId);
  }

  /** Updates a project after verifying management permission and its existence. */
  public async update(
    actor: User,
    projectId: string,
    project: ProjectUpdate,
  ): Promise<void> {
    await this.management.update(actor, projectId, project);
  }

  /** Archives a project without deleting it. */
  public async archive(actor: User, projectId: string): Promise<void> {
    await this.management.archive(actor, projectId);
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
    await this.management.replaceIcon(actor, projectId, icon);
  }

  /** Returns whether the actor is allowed to create and edit projects. */
  public async canManageProjects(actor: User): Promise<boolean> {
    return this.permissionService.hasCapability(
      actor,
      CAPABILITY.MANAGE_PROJECTS,
    );
  }

  /** Project creation and management share the same capability. */
  public async canCreateProjects(actor: User): Promise<boolean> {
    return this.permissionService.hasCapability(
      actor,
      CAPABILITY.MANAGE_PROJECTS,
    );
  }

  /** Updates the extended detail values of a project and records the change. */
  public async updateDetails(
    actor: User,
    projectId: string,
    update: ProjectDetailsUpdate,
  ): Promise<Project> {
    return this.management.updateDetails(actor, projectId, update);
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
    await this.recordActivity(actor, projectId, {
      action: "member_added",
      category: "team",
      message: `A person was added to the project as ${role}.`,
    });
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
    await this.recordActivity(actor, projectId, {
      action: "role_changed",
      category: "team",
      message: `A project role was changed to ${role}.`,
    });
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
    await this.recordActivity(actor, projectId, {
      action: "member_removed",
      category: "team",
      message: `A person was removed from the project.`,
    });
  }

  /** Returns whether the actor may write in the project context. */
  public async canWriteProject(
    actor: User,
    projectId: string,
  ): Promise<boolean> {
    return this.access.canWrite(actor, projectId);
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
    await this.recordActivity(actor, projectId, {
      action: "goal_created",
      category: "planning",
      message: `Goal "${trimmed}" was created.`,
    });
  }

  /** Updates a goal. */
  public async updateGoal(
    actor: User,
    projectId: string,
    goalId: string,
    changes: { readonly title: string; readonly isDone: boolean },
  ): Promise<void> {
    const { title, isDone } = changes;

    await this.requireProjectWrite(actor, projectId);
    await this.getById(actor, projectId);
    await this.requireGoal(projectId, goalId);

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
    await this.requireGoal(projectId, goalId);
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
      eventTime: normalizeEventTime(event.eventTime),
      id: randomUUID(),
      projectId,
      title,
      type: event.type.trim().slice(0, 40) || "general",
    });
    await this.recordActivity(actor, projectId, {
      action: "event_created",
      category: "planning",
      message: `Date "${title}" was created for ${event.eventDate}.`,
    });
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
    await this.requireEvent(projectId, eventId);

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
      eventTime: normalizeEventTime(event.eventTime),
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
    await this.requireEvent(projectId, eventId);
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
    await this.recordActivity(actor, projectId, {
      action: "integration_saved",
      category: "integrations",
      message: `GitHub integration settings were saved.`,
    });

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
    await this.recordActivity(actor, projectId, {
      action: "integration_disconnected",
      category: "integrations",
      message: `GitHub connection was removed.`,
    });
  }

  /** Returns the chronological activity log of a project. */
  public async findActivity(
    actor: User,
    projectId: string,
  ): Promise<ProjectActivity[]> {
    await this.getById(actor, projectId);

    return this.projectRepository.findActivity(
      projectId,
      await this.workItemVisibility(actor),
    );
  }

  private async requireGoal(projectId: string, goalId: string): Promise<void> {
    if (
      !(await this.projectRepository.findGoals(projectId)).some(
        (goal) => goal.id === goalId,
      )
    )
      throw new ProjectManagementDeniedError();
  }

  private async requireEvent(
    projectId: string,
    eventId: string,
  ): Promise<void> {
    if (
      !(await this.projectRepository.findEvents(projectId)).some(
        (event) => event.id === eventId,
      )
    )
      throw new ProjectManagementDeniedError();
  }

  private async requireProjectWrite(
    actor: User,
    projectId: string,
  ): Promise<void> {
    if (!(await this.canWriteProject(actor, projectId))) {
      throw new ProjectManagementDeniedError();
    }
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
    activity: Pick<NewProjectActivity, "action" | "category" | "message">,
  ): Promise<void> {
    const entry: NewProjectActivity = {
      ...activity,
      id: randomUUID(),
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

// A blank time means the date has no time, so an empty string must not be stored.
function normalizeEventTime(eventTime: string | null): string | null {
  const trimmedTime = eventTime?.trim();

  return trimmedTime === undefined || trimmedTime === "" ? null : trimmedTime;
}

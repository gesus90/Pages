import { ProjectActivityRepository } from "./project/ProjectActivityRepository";
import { ProjectCoreRepository } from "./project/ProjectCoreRepository";
import { ProjectEventRepository } from "./project/ProjectEventRepository";
import { ProjectGoalRepository } from "./project/ProjectGoalRepository";
import { ProjectIconRepository } from "./project/ProjectIconRepository";
import { ProjectIntegrationRepository } from "./project/ProjectIntegrationRepository";
import { ProjectMemberRepository } from "./project/ProjectMemberRepository";
import { ProjectTagRepository } from "./project/ProjectTagRepository";

import type { Database } from "@/backend/database/Database";
import type {
  Project,
  ProjectActivity,
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
  ProjectRole,
} from "@/definition/Project";
import type { NewProjectActivity } from "./project/ProjectActivityRepository";
import type {
  NewProject,
  ProjectDetailsUpdate,
  ProjectUpdate,
} from "./project/ProjectCoreRepository";
import type {
  NewProjectEvent,
  ProjectEventUpdate,
} from "./project/ProjectEventRepository";
import type { NewProjectGoal } from "./project/ProjectGoalRepository";
import type { ProjectIcon } from "./project/ProjectIconRepository";
import type {
  DueGitHubSync,
  NewProjectIntegration,
  ProjectSyncSchedule,
} from "./project/ProjectIntegrationRepository";

export type { NewProjectActivity } from "./project/ProjectActivityRepository";
export type {
  NewProject,
  ProjectDetailsUpdate,
  ProjectUpdate,
} from "./project/ProjectCoreRepository";
export type {
  NewProjectEvent,
  ProjectEventUpdate,
} from "./project/ProjectEventRepository";
export type { NewProjectGoal } from "./project/ProjectGoalRepository";
export type { ProjectIcon } from "./project/ProjectIconRepository";
export type {
  DueGitHubSync,
  NewProjectIntegration,
  ProjectSyncSchedule,
} from "./project/ProjectIntegrationRepository";

/**
 * Establishes the persistence boundary for projects.
 *
 * @remarks
 * A facade over one repository per aggregate in `./project/`; it only
 * forwards and holds no persistence logic of its own.
 */
export class ProjectRepository {
  private readonly projects: ProjectCoreRepository;
  private readonly members: ProjectMemberRepository;
  private readonly icons: ProjectIconRepository;
  private readonly goals: ProjectGoalRepository;
  private readonly tags: ProjectTagRepository;
  private readonly events: ProjectEventRepository;
  private readonly integrations: ProjectIntegrationRepository;
  private readonly activity: ProjectActivityRepository;

  /**
   * Creates a project repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.projects = new ProjectCoreRepository(database);
    this.members = new ProjectMemberRepository(database);
    this.icons = new ProjectIconRepository(database);
    this.goals = new ProjectGoalRepository(database);
    this.tags = new ProjectTagRepository(database);
    this.events = new ProjectEventRepository(database);
    this.integrations = new ProjectIntegrationRepository(database);
    this.activity = new ProjectActivityRepository(database);
  }

  /** Returns every non-archived project ordered by most recent change. */
  public async findAll(): Promise<Project[]> {
    return this.projects.findAll();
  }

  /** Returns the non-archived projects that include the given member. */
  public async findByMemberId(memberId: string): Promise<Project[]> {
    return this.projects.findByMemberId(memberId);
  }

  /** Returns a non-archived project by identifier. */
  public async findById(id: string): Promise<Project | null> {
    return this.projects.findById(id);
  }

  /** Returns whether the user belongs to the project. */
  public async isMember(projectId: string, userId: string): Promise<boolean> {
    return this.members.isMember(projectId, userId);
  }

  /** Returns whether the user holds the project manager role in the project. */
  public async isProjectManager(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    return this.members.isProjectManager(projectId, userId);
  }

  /** Inserts a project and its owner membership. */
  public async insert(project: NewProject): Promise<void> {
    await this.projects.insert(project);
  }

  /** Updates the editable values of a non-archived project. */
  public async update(id: string, project: ProjectUpdate): Promise<void> {
    await this.projects.update(id, project);
  }

  /** Updates the extended detail values of a non-archived project. */
  public async updateDetails(
    id: string,
    project: ProjectDetailsUpdate,
  ): Promise<void> {
    await this.projects.updateDetails(id, project);
  }

  /** Marks a project as archived without deleting persisted data. */
  public async archive(id: string): Promise<void> {
    await this.projects.archive(id);
  }

  /** Returns the custom icon attached to a project. */
  public async findIconByProjectId(
    projectId: string,
  ): Promise<ProjectIcon | null> {
    return this.icons.findByProjectId(projectId);
  }

  /** Creates or replaces the custom icon attached to a project. */
  public async upsertIcon(projectId: string, icon: ProjectIcon): Promise<void> {
    await this.icons.upsert(projectId, icon);
  }

  /** Returns every person assigned to the project with their project role. */
  public async findMembers(projectId: string): Promise<ProjectMember[]> {
    return this.members.findByProjectId(projectId);
  }

  /** Adds a person to the project with the given project role. */
  public async addMember(
    projectId: string,
    userId: string,
    role: ProjectRole,
    joinedAt?: string,
  ): Promise<void> {
    await this.members.add(projectId, userId, role, joinedAt);
  }

  /** Changes the project role of an assigned person. */
  public async updateMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<void> {
    await this.members.updateRole(projectId, userId, role);
  }

  /** Removes a person from the project. */
  public async removeMember(projectId: string, userId: string): Promise<void> {
    await this.members.remove(projectId, userId);
  }

  /** Returns the goals of a project ordered by position. */
  public async findGoals(projectId: string): Promise<ProjectGoal[]> {
    return this.goals.findByProjectId(projectId);
  }

  /** Inserts a goal for the project. */
  public async insertGoal(goal: NewProjectGoal): Promise<void> {
    await this.goals.insert(goal);
  }

  /** Updates the title and completion state of a goal. */
  public async updateGoal(
    id: string,
    title: string,
    isDone: boolean,
  ): Promise<void> {
    await this.goals.update(id, title, isDone);
  }

  /** Deletes a goal. */
  public async deleteGoal(id: string): Promise<void> {
    await this.goals.delete(id);
  }

  /** Returns the tags assigned to the project. */
  public async findTags(projectId: string): Promise<string[]> {
    return this.tags.findByProjectId(projectId);
  }

  /** Replaces all tags assigned to the project. */
  public async setTags(
    projectId: string,
    tags: readonly string[],
  ): Promise<void> {
    await this.tags.replace(projectId, tags);
  }

  /** Returns the non-archived planning dates of a project. */
  public async findEvents(projectId: string): Promise<ProjectEvent[]> {
    return this.events.findByProjectId(projectId);
  }

  /** Inserts a planning date for the project. */
  public async insertEvent(event: NewProjectEvent): Promise<void> {
    await this.events.insert(event);
  }

  /** Updates a planning date. */
  public async updateEvent(
    id: string,
    event: ProjectEventUpdate,
  ): Promise<void> {
    await this.events.update(id, event);
  }

  /** Archives a planning date without deleting it. */
  public async archiveEvent(id: string): Promise<void> {
    await this.events.archive(id);
  }

  /** Returns the sanitized GitHub integration settings for a project. */
  public async findIntegration(
    projectId: string,
  ): Promise<ProjectIntegration | null> {
    return this.integrations.findByProjectId(projectId);
  }

  /** Returns the sanitized GitHub integration settings of several projects. */
  public async findIntegrationsByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectIntegration>> {
    return this.integrations.findByProjectIds(projectIds);
  }

  /**
   * Returns the encrypted GitHub token for server-side API calls.
   *
   * @param projectId - Project the integration belongs to.
   * @returns The encrypted token, or `null` when none is stored.
   *
   * @remarks
   * The result must never leave the server: routes and services only
   * expose the `hasToken` indicator to the browser.
   */
  public async findTokenEncrypted(projectId: string): Promise<string | null> {
    return this.integrations.findTokenEncrypted(projectId);
  }

  /** Returns integrations with a due scheduled synchronization run. */
  public async findDueSyncIntegrations(
    nowIso: string,
  ): Promise<DueGitHubSync[]> {
    return this.integrations.findDueSyncs(nowIso);
  }

  /** Records the synchronization timestamps of a project integration. */
  public async updateSyncSchedule(
    projectId: string,
    schedule: ProjectSyncSchedule,
  ): Promise<void> {
    await this.integrations.updateSyncSchedule(projectId, schedule);
  }

  /**
   * Creates or replaces the integration settings without ever returning the secret.
   *
   * @param projectId - Project the integration belongs to.
   * @param integration - Sanitized settings; a `null` token hash keeps the stored secret.
   */
  public async upsertIntegration(
    projectId: string,
    integration: NewProjectIntegration,
  ): Promise<void> {
    await this.integrations.upsert(projectId, integration);
  }

  /** Removes the integration settings including the stored secret hash. */
  public async deleteIntegration(projectId: string): Promise<void> {
    await this.integrations.delete(projectId);
  }

  /** Returns the chronological activity log of a project, newest last. */
  public async findActivity(projectId: string): Promise<ProjectActivity[]> {
    return this.activity.findByProjectId(projectId);
  }

  /** Records an entry in the chronological project activity log. */
  public async insertActivity(entry: NewProjectActivity): Promise<void> {
    await this.activity.insert(entry);
  }
}

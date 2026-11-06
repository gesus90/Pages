import { ProjectActivityRepository } from "./project/ProjectActivityRepository";
import { PagesEventOutboxRepository } from "./events/PagesEventOutboxRepository";
import { ProjectCoreRepository } from "./project/ProjectCoreRepository";
import { ProjectDeletionScopeRepository } from "./project/ProjectDeletionScopeRepository";
import { ProjectDepartmentRepository } from "./project/ProjectDepartmentRepository";
import { ProjectLifecycleRepository } from "./project/ProjectLifecycleRepository";
import { ProjectTemplateRepository } from "./project/ProjectTemplateRepository";
import { AuthorizationRepository } from "./AuthorizationRepository";
import { ProjectEventRepository } from "./project/ProjectEventRepository";
import { ProjectGoalRepository } from "./project/ProjectGoalRepository";
import { ProjectIconRepository } from "./project/ProjectIconRepository";
import { ProjectIntegrationRepository } from "./project/ProjectIntegrationRepository";
import { ProjectMemberRepository } from "./project/ProjectMemberRepository";
import { ProjectTagRepository } from "./project/ProjectTagRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { ProjectDeletionScope } from "@/definition/AgentProjectDeletion";
import type { PagesEventRecord } from "./events/PagesEventOutboxRepository";
import type { WorkItemVisibility } from "@/definition/Task";
import type { WikiVisibilityScope } from "@/definition/Wiki";
import type { Department } from "@/definition/Authorization";
import type {
  ArchivedProject,
  Project,
  ProjectActivity,
  ProjectActivitySource,
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
  ProjectRole,
  ProjectTemplate,
} from "@/definition/Project";
import type { NewProjectActivity } from "./project/ProjectActivityRepository";
import type {
  NewProject,
  ProjectDetailsUpdate,
  ProjectUpdate,
} from "./project/ProjectCoreRepository";
import type { ProjectDeletionFiles } from "./project/ProjectDeletionFiles";
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
  AgentRunRecordKey,
  ProjectDeletionFiles,
} from "./project/ProjectDeletionFiles";
export type {
  DueGitHubSync,
  NewProjectIntegration,
  ProjectSyncSchedule,
} from "./project/ProjectIntegrationRepository";

/** Supports both database-owned and already locked project transactions. */
type ProjectDatabase = Pick<
  Database,
  "execute" | "query" | "transaction" | "readTransaction"
>;

/** Binds every operation, nested transactions included, to one open transaction. */
function transactionScope(transaction: DatabaseTransaction): ProjectDatabase {
  const reuse = async <Nested>(
    operation: (scope: DatabaseTransaction) => Promise<Nested>,
  ): Promise<Nested> => operation(transaction);
  return {
    query: transaction.query.bind(transaction),
    execute: transaction.execute.bind(transaction),
    transaction: reuse,
    // Reads inside a writer transaction must see its own uncommitted writes.
    readTransaction: reuse,
  };
}

/** What a permanent deletion removes, and the people who lose their assignment with it. */
export interface ProjectDeletionDetails {
  readonly scope: ProjectDeletionScope;
  readonly memberIds: readonly string[];
}

/**
 * Establishes the persistence boundary for projects.
 *
 * @remarks
 * Coordinates the project aggregates and their shared transaction.
 */
export class ProjectRepository {
  private readonly database: ProjectDatabase;
  private readonly source: ProjectActivitySource;
  private readonly departments: ProjectDepartmentRepository;
  private readonly lifecycle: ProjectLifecycleRepository;
  private readonly deletionScope: ProjectDeletionScopeRepository;
  private readonly templates: ProjectTemplateRepository;
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
  public constructor(
    database: ProjectDatabase,
    source: ProjectActivitySource = "ui",
  ) {
    this.source = source;
    this.database = database;
    this.departments = new ProjectDepartmentRepository(database);
    this.lifecycle = new ProjectLifecycleRepository(database);
    this.deletionScope = new ProjectDeletionScopeRepository(database);
    this.templates = new ProjectTemplateRepository(database);
    this.projects = new ProjectCoreRepository(database);
    this.members = new ProjectMemberRepository(database);
    this.icons = new ProjectIconRepository(database);
    this.goals = new ProjectGoalRepository(database);
    this.tags = new ProjectTagRepository(database);
    this.events = new ProjectEventRepository(database);
    this.integrations = new ProjectIntegrationRepository(database);
    this.activity = new ProjectActivityRepository(database, source);
  }

  /** Returns every non-archived project ordered by most recent change. */
  public async findAll(): Promise<Project[]> {
    return this.withDepartments(await this.projects.findAll());
  }

  /** Returns live identifiers before consulting cached project rows. */
  public async findActiveIds(): Promise<string[]> {
    return this.projects.findActiveIds();
  }

  /** Reads template snapshots before service-side current source access checks. */
  public async findTemplates(): Promise<ProjectTemplate[]> {
    return this.templates.findAll();
  }

  /** Saves a validated source snapshot inside the caller's transaction. */
  public async saveTemplate(template: ProjectTemplate): Promise<void> {
    await this.templates.save(template);
  }

  /** Returns live assignments for authorization of an entire active listing. */
  public async findDepartmentsByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, Department[]>> {
    return this.departments.findByProjectIds(projectIds);
  }

  /** Returns archived projects with their current department assignments. */
  public async findArchived(): Promise<ArchivedProject[]> {
    return this.withDepartments(await this.projects.findArchived());
  }

  /** Returns an archived project for authorized retention or deletion actions. */
  public async findArchivedById(id: string): Promise<ArchivedProject | null> {
    const project = await this.projects.findArchivedById(id);
    if (!project) return null;
    return {
      ...project,
      departments: await this.departments.findByProjectId(id),
    };
  }

  /** Returns the non-archived projects that include the given member. */
  public async findByMemberId(memberId: string): Promise<Project[]> {
    return this.withDepartments(await this.projects.findByMemberId(memberId));
  }

  /** Returns a non-archived project by identifier. */
  public async findById(id: string): Promise<Project | null> {
    const project = await this.projects.findById(id);
    if (!project) return null;
    return {
      ...project,
      departments: await this.departments.findByProjectId(id),
    };
  }

  /** Runs project policy reads and writes atomically with current account facts. */
  public async transaction<Result>(
    work: (repository: ProjectRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((transaction) =>
      work(new ProjectRepository(transactionScope(transaction), this.source)),
    );
  }

  /**
   * Runs read-only project policy reads on one consistent snapshot.
   *
   * @param work - Receives a repository bound to the read; it must only read.
   * @returns Whatever `work` returns.
   *
   * @remarks
   * At the top level the reads do not wait for the writer. Inside a project
   * transaction they reuse it, so they see its uncommitted changes.
   */
  public async readTransaction<Result>(
    work: (repository: ProjectRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.readTransaction((transaction) =>
      work(new ProjectRepository(transactionScope(transaction), this.source)),
    );
  }

  /** Provides current authorization inside the project transaction. */
  public authorization(): AuthorizationRepository {
    return new AuthorizationRepository(this.database);
  }

  /** Returns the live department assignments. */
  public async findDepartments(projectId: string): Promise<Department[]> {
    return this.departments.findByProjectId(projectId);
  }

  /** Replaces department assignments after service validation. */
  public async setDepartments(
    projectId: string,
    departmentIds: readonly string[],
  ): Promise<void> {
    await this.departments.replace(projectId, departmentIds);
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

  /** Returns the projects in which the user holds the project manager role. */
  public async findManagedProjectIds(userId: string): Promise<string[]> {
    return this.members.findManagedProjectIds(userId);
  }

  /** Inserts a project and its owner membership. */
  public async insert(project: NewProject): Promise<void> {
    await this.transaction(async (repository) => {
      await repository.projects.insert(project);
      await repository.setDepartments(project.id, project.departmentIds ?? []);
    });
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

  /**
   * Marks a project as archived without deleting persisted data.
   *
   * @returns Whether the project was active before.
   */
  public async archive(id: string): Promise<boolean> {
    return this.projects.archive(id);
  }

  /**
   * Stores a Pages event in the transaction this repository is bound to.
   *
   * @param event - Kind and project, never content.
   */
  public async appendEvent(event: PagesEventRecord): Promise<void> {
    await new PagesEventOutboxRepository(this.database).append(event);
  }

  /**
   * Permanently removes the project aggregate inside one transaction.
   *
   * @param id - The project to delete, whether active or archived.
   * @returns The files whose rows went; the caller removes them after the commit.
   */
  public async deletePermanently(id: string): Promise<ProjectDeletionFiles> {
    return this.transaction((repository) => repository.lifecycle.delete(id));
  }

  /**
   * Describes the project and the data a permanent deletion would remove.
   *
   * @param projectId - The project, whether active or archived.
   * @returns The extent of the deletion, or `null` when no such project exists.
   */
  public async describeDeletion(
    projectId: string,
  ): Promise<ProjectDeletionDetails | null> {
    const record = await this.deletionScope.findRecord(projectId);
    if (!record) return null;
    const departments = await this.departments.findByProjectId(projectId);
    return {
      memberIds: await this.deletionScope.findMemberIds(projectId),
      scope: {
        project: {
          id: projectId,
          ...record,
          departmentNames: departments.map(({ name }) => name),
        },
        counts: await this.deletionScope.count(projectId),
        detached: await this.deletionScope.countDetachments(projectId),
      },
    };
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

  /**
   * Replaces all tags assigned to the project.
   *
   * @remarks
   * All or nothing: PostgreSQL refuses a tag with U+0000, and the old tags must
   * survive that.
   */
  public async setTags(
    projectId: string,
    tags: readonly string[],
  ): Promise<void> {
    await this.transaction((repository) =>
      repository.tags.replace(projectId, tags),
    );
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
   * Moves the next scheduled synchronization of a project without touching
   * the time of the last successful one.
   *
   * @param projectId - Project the integration belongs to.
   * @param nextSyncAt - ISO timestamp of the next scheduled attempt.
   */
  public async deferNextSync(
    projectId: string,
    nextSyncAt: string,
  ): Promise<void> {
    await this.integrations.deferNextSync(projectId, nextSyncAt);
  }

  /**
   * Clears the connected state of an integration, if it still holds the rejected token.
   *
   * @param projectId - Project the integration belongs to.
   * @param rejectedToken - The encrypted token the failed run used.
   */
  public async markIntegrationDisconnected(
    projectId: string,
    rejectedToken: string,
  ): Promise<void> {
    await this.integrations.markDisconnected(projectId, rejectedToken);
  }

  /** Switches the GitHub synchronization of a project on or off. */
  public async setIntegrationSyncEnabled(
    projectId: string,
    isEnabled: boolean,
  ): Promise<void> {
    await this.integrations.setSyncEnabled(projectId, isEnabled);
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
  public async findActivity(
    projectId: string,
    visibility?: WorkItemVisibility,
    wikiScope?: WikiVisibilityScope,
  ): Promise<ProjectActivity[]> {
    return this.activity.findByProjectId(projectId, visibility, wikiScope);
  }

  /** Records an entry in the chronological project activity log. */
  public async insertActivity(entry: NewProjectActivity): Promise<void> {
    await this.activity.insert(entry);
  }

  private async withDepartments<Details extends Project>(
    projects: Details[],
  ): Promise<Details[]> {
    const assignments = await this.departments.findByProjectIds(
      projects.map((project) => project.id),
    );
    return projects.map((project) => ({
      ...project,
      departments: assignments.get(project.id) ?? [],
    }));
  }
}

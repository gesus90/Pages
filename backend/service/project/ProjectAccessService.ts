import { accountForChannel } from "@/backend/auth/McpActorContext";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CACHE_TTLS } from "@/backend/cache/ServerCache";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { AccountAccess, Department } from "@/definition/Authorization";
import type { Project } from "@/definition/Project";
import type { WorkItemVisibility } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Current account and accessible projects, kept exclusively on the server. */
export interface ProjectReadScope {
  readonly account: AccountAccess;
  readonly projectIds: readonly string[];
  readonly departments: ReadonlyMap<string, Department[]>;
  readonly visibility: WorkItemVisibility;
}

/** The active account and the live department catalog it acts on. */
export interface AuthorizationFacts {
  readonly account: AccountAccess;
  readonly departments: readonly Department[];
}

/** Reads projects using current account facts before any cached data leaves the server. */
export class ProjectAccessService {
  private readonly repository: ProjectRepository;
  private readonly cache: ServerCache;
  private readonly channel: ActorChannel;
  private readonly policy = new ProjectPolicyService();
  private readonly users = new UserPolicyService();

  /** Shares the project persistence and raw row cache. */
  public constructor(
    repository: ProjectRepository,
    cache: ServerCache,
    channel: ActorChannel = "ui",
  ) {
    this.repository = repository;
    this.cache = cache;
    this.channel = channel;
  }

  /** Loads the active account from live persisted authorization. */
  public async account(actor: User): Promise<AccountAccess> {
    const snapshot = await this.repository.authorization().snapshot();
    const account = snapshot.accounts.find(
      (entry) => entry.userId === actor.id,
    );
    if (!account?.isActive) throw new ProjectAccessDeniedError();
    return accountForChannel(account, this.channel);
  }

  /** Loads the active account together with the live department catalog from one snapshot. */
  public async authorizationFacts(actor: User): Promise<AuthorizationFacts> {
    const snapshot = await this.repository.authorization().snapshot();
    const account = snapshot.accounts.find(
      (entry) => entry.userId === actor.id,
    );
    if (!account?.isActive) throw new ProjectAccessDeniedError();
    return {
      account: accountForChannel(account, this.channel),
      departments: snapshot.departments,
    };
  }

  /** Resolves project and ticket read scope consistently inside one transaction. */
  public async scope(actor: User): Promise<ProjectReadScope> {
    return this.repository.transaction(async (repository) => {
      const access = new ProjectAccessService(
        repository,
        this.cache,
        this.channel,
      );
      const account = await access.account(actor);
      const activeIds = await repository.findActiveIds();
      const departments = await repository.findDepartmentsByProjects(activeIds);
      const projectIds = activeIds.filter((id) =>
        this.policy.canAccess(
          account,
          (departments.get(id) ?? []).map((department) => department.id),
        ),
      );
      return {
        account,
        projectIds,
        departments,
        visibility: {
          departmentIds: this.users.isAdministrator(account)
            ? null
            : account.departments,
          projectIds,
        },
      };
    });
  }

  /** Filters cached rows using freshly resolved project scope and department names. */
  public async findAll(actor: User): Promise<Project[]> {
    const scope = await this.scope(actor);
    const key = "projects:list:raw";
    const projects =
      this.cache.get<Project[]>(key) ?? (await this.repository.findAll());
    this.cache.set(key, projects, CACHE_TTLS.projectsList);
    return projects
      .filter((project) => scope.projectIds.includes(project.id))
      .map((project) => ({
        ...project,
        departments: scope.departments.get(project.id) ?? [],
      }));
  }

  /** Authorizes a fresh active project record, including after archive or scope changes. */
  public async getById(actor: User, projectId: string): Promise<Project> {
    const account = await this.account(actor);
    const project = await this.repository.findById(projectId);
    if (!project) throw new ProjectNotFoundError();
    if (
      !this.policy.canAccess(
        account,
        project.departments.map((department) => department.id),
      )
    )
      throw new ProjectAccessDeniedError();
    return project;
  }

  /** General project managers and scoped co-owners must also have current read access. */
  public async canWrite(actor: User, projectId: string): Promise<boolean> {
    const account = await this.account(actor);
    const project = await this.repository.findById(projectId);
    if (!project) return false;
    const departmentIds = project.departments.map(
      (department) => department.id,
    );
    if (!this.policy.canAccess(account, departmentIds)) return false;
    return this.policy.canEditGeneral(account, {
      departmentIds,
      isProjectManager: await this.repository.isProjectManager(
        projectId,
        actor.id,
      ),
    });
  }

  /** Rechecks candidate assignees against current account access even when their catalog is cached. */
  public async filterAssignees(
    candidates: ReadonlyMap<string, readonly User[]>,
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    return this.repository.transaction(async (repository) => {
      const snapshot = await repository.authorization().snapshot();
      const accounts = new Map(
        snapshot.accounts.map((account) => [account.userId, account]),
      );
      const activeIds = new Set(await repository.findActiveIds());
      const departments = await repository.findDepartmentsByProjects([
        ...candidates.keys(),
      ]);
      const eligible = new Map<string, readonly User[]>();
      for (const [projectId, users] of candidates) {
        if (!activeIds.has(projectId)) continue;
        const departmentIds = (departments.get(projectId) ?? []).map(
          (department) => department.id,
        );
        eligible.set(
          projectId,
          users.filter((user) => {
            const account = accounts.get(user.id);
            return (
              account !== undefined &&
              this.policy.canAccess(account, departmentIds)
            );
          }),
        );
      }
      return eligible;
    });
  }
}

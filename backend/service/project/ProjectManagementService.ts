import { randomUUID } from "node:crypto";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import {
  ProjectDepartmentError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { isProjectStatus } from "@/definition/Project";
import { ProjectAccessService } from "./ProjectAccessService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type {
  ProjectDetailsUpdate,
  ProjectIcon,
  ProjectRepository,
  ProjectUpdate,
} from "@/backend/database/repositories/ProjectRepository";
import type {
  ArchivedProject,
  Project,
  ProjectActionPermissions,
} from "@/definition/Project";
import type { User } from "@/definition/User";

/** Applies current access, shared ownership and full-scope lifecycle rules atomically. */
export class ProjectManagementService {
  private readonly repository: ProjectRepository;
  private readonly cache: ServerCache;
  private readonly policy = new ProjectPolicyService();

  /** Binds policy checks to the project transaction and cache boundary. */
  public constructor(repository: ProjectRepository, cache: ServerCache) {
    this.repository = repository;
    this.cache = cache;
  }

  /** Archive listings offer permanent deletion only in current administrator mode. */
  public async canDelete(actor: User): Promise<boolean> {
    return this.policy.canDelete(
      await new ProjectAccessService(this.repository, this.cache).account(
        actor,
      ),
    );
  }

  /** Computes UI action hints without replacing server-side mutation checks. */
  public async permissions(
    actor: User,
    projectId: string,
  ): Promise<ProjectActionPermissions> {
    return this.repository.transaction(async (repository) => {
      const access = new ProjectAccessService(repository, this.cache);
      const account = await access.account(actor);
      const active = await repository.findById(projectId);
      const project = active ?? (await repository.findArchivedById(projectId));
      if (!project) throw new ProjectNotFoundError();
      const ids = project.departments.map((department) => department.id);
      const canAccess = this.policy.canAccess(account, ids);
      return {
        canEditGeneral:
          Boolean(active) &&
          canAccess &&
          this.policy.canEditGeneral(account, {
            departmentIds: ids,
            isProjectManager: await repository.isProjectManager(
              projectId,
              actor.id,
            ),
          }),
        canChangeDepartments:
          Boolean(active) &&
          canAccess &&
          this.policy.canManageAssignments(account, ids),
        canArchive:
          Boolean(active) && canAccess && this.policy.canArchive(account, ids),
        canDelete: canAccess && this.policy.canDelete(account),
      };
    });
  }

  /** Retained archive metadata follows the same current project access rules. */
  public async findArchived(actor: User): Promise<ArchivedProject[]> {
    const account = await new ProjectAccessService(
      this.repository,
      this.cache,
    ).account(actor);
    const projects = await this.repository.findArchived();
    return projects.filter((project) =>
      this.policy.canAccess(
        account,
        project.departments.map((department) => department.id),
      ),
    );
  }

  /** Updates general values with the minimum assignment requirement checked inside the transaction. */
  public async update(
    actor: User,
    projectId: string,
    input: ProjectUpdate,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const project = await this.requireWrite(repository, actor, projectId);
      const snapshot = await repository.authorization().snapshot();
      this.requireMinimum(project.departments.length, snapshot);
      this.validateGeneral(input);
      await repository.update(projectId, {
        ...input,
        name: input.name.trim(),
        description: input.description.trim(),
      });
    });
    this.cache.invalidateProject(projectId);
  }

  /** Saves detail fields and their activity together after current co-owner authorization. */
  public async updateDetails(
    actor: User,
    projectId: string,
    input: ProjectDetailsUpdate,
  ): Promise<Project> {
    const updated = await this.repository.transaction(async (repository) => {
      const project = await this.requireWrite(repository, actor, projectId);
      const snapshot = await repository.authorization().snapshot();
      this.requireMinimum(project.departments.length, snapshot);
      this.validateGeneral(input);
      if (input.notes.trim().length > 10_000)
        throw new Error("Project notes must not exceed 10,000 characters.");
      if (input.managerId) {
        const members = await repository.findMembers(projectId);
        if (!members.some((member) => member.userId === input.managerId))
          throw new Error(
            "The project manager must be a member of the project.",
          );
      }
      await repository.updateDetails(projectId, {
        ...input,
        name: input.name.trim(),
        description: input.description.trim(),
        notes: input.notes.trim(),
      });
      await repository.insertActivity({
        id: randomUUID(),
        projectId,
        userId: actor.id,
        action: "project_updated",
        category: "project",
        message: "Project details were updated.",
      });
      const result = await repository.findById(projectId);
      if (!result) throw new ProjectNotFoundError();
      return result;
    });
    this.cache.invalidateProject(projectId);
    return updated;
  }

  /** Replaces an icon using shared project responsibility rather than only global management. */
  public async replaceIcon(
    actor: User,
    projectId: string,
    icon: ProjectIcon,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      await this.requireWrite(repository, actor, projectId);
      await repository.upsertIcon(projectId, icon);
    });
    this.cache.invalidateProject(projectId);
  }

  /** Checks the full pre-change scope and every new assignment in the same transaction. */
  public async setDepartments(
    actor: User,
    projectId: string,
    departmentIds: readonly string[],
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const access = new ProjectAccessService(repository, this.cache);
      const account = await access.account(actor);
      const project = await access.getById(actor, projectId);
      const snapshot = await repository.authorization().snapshot();
      const next = [...new Set(departmentIds)];
      if (
        !this.policy.canManageAssignments(
          account,
          project.departments.map((department) => department.id),
        )
      )
        throw new ProjectManagementDeniedError();
      this.requireMinimum(next.length, snapshot);
      if (
        next.some(
          (id) =>
            !snapshot.departments.some((department) => department.id === id),
        )
      )
        throw new ProjectDepartmentError("invalidDepartment");
      if (
        !this.policy.canChangeDepartments(
          account,
          project.departments.map((department) => department.id),
          {
            departmentIds: next,
            hasDepartments: snapshot.departments.length > 0,
          },
        )
      )
        throw new ProjectDepartmentError("departmentOutOfScope");
      await repository.setDepartments(projectId, next);
    });
    this.invalidateScope(projectId);
  }

  /** Archives only with the explicit archive capability and complete current scope. */
  public async archive(actor: User, projectId: string): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const access = new ProjectAccessService(repository, this.cache);
      const account = await access.account(actor);
      const project = await access.getById(actor, projectId);
      if (
        !this.policy.canArchive(
          account,
          project.departments.map((department) => department.id),
        )
      )
        throw new ProjectManagementDeniedError();
      await repository.archive(projectId);
    });
    this.invalidateScope(projectId);
  }

  /** Permanently deletes active or archived projects only in current active administrator mode. */
  public async deletePermanently(
    actor: User,
    projectId: string,
  ): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const account = await new ProjectAccessService(
        repository,
        this.cache,
      ).account(actor);
      if (!this.policy.canDelete(account))
        throw new ProjectManagementDeniedError();
      const project =
        (await repository.findById(projectId)) ??
        (await repository.findArchivedById(projectId));
      if (!project) throw new ProjectNotFoundError();
      await repository.deletePermanently(projectId);
    });
    this.invalidateScope(projectId);
    this.cache.invalidatePrefix("project:", "statuses:");
  }

  private async requireWrite(
    repository: ProjectRepository,
    actor: User,
    projectId: string,
  ): Promise<Project> {
    const access = new ProjectAccessService(repository, this.cache);
    const project = await access.getById(actor, projectId);
    if (!(await access.canWrite(actor, projectId)))
      throw new ProjectManagementDeniedError();
    return project;
  }

  private requireMinimum(count: number, snapshot: AuthorizationSnapshot): void {
    if (snapshot.departments.length > 0 && count === 0)
      throw new ProjectDepartmentError("departmentRequired");
  }

  private validateGeneral(input: ProjectUpdate): void {
    if (!input.name.trim() || input.name.trim().length > 200)
      throw new Error("Project name must be between 1 and 200 characters.");
    if (
      input.description.trim().length > 10_000 ||
      !isProjectStatus(input.status) ||
      !Number.isInteger(input.progress) ||
      input.progress < 0 ||
      input.progress > 100
    )
      throw new Error("Invalid project input.");
  }

  private invalidateScope(projectId: string): void {
    this.cache.invalidateProject(projectId);
    this.cache.invalidateProjectMembership();
    this.cache.invalidateWorkItems();
    this.cache.invalidateLabels();
    this.cache.invalidateGitHub();
  }
}

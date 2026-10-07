import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { CAPABILITY } from "@/definition/Authorization";
import { isProjectStatus } from "@/definition/Project";
import {
  ProjectDepartmentError,
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
} from "@/backend/error/ProjectErrors";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  NewProject,
  ProjectRepository,
} from "@/backend/database/repositories/ProjectRepository";
import type { ProjectDepartmentChoices } from "@/definition/Project";
import type { User } from "@/definition/User";

/** Creates projects and their assignments under one current-facts transaction. */
export class ProjectCreationService {
  private readonly repository: ProjectRepository;
  private readonly cache: ServerCache;
  private readonly policy = new ProjectPolicyService();
  private readonly users = new UserPolicyService();

  /** Binds project creation and catalog choices to their shared persistence boundary. */
  public constructor(repository: ProjectRepository, cache: ServerCache) {
    this.repository = repository;
    this.cache = cache;
  }

  /** Returns only departments the actor may assign to a new project. */
  public async choices(actor: User): Promise<ProjectDepartmentChoices> {
    const snapshot = await this.repository.authorization().snapshot();
    const account = snapshot.accounts.find(
      (entry) => entry.userId === actor.id,
    );
    if (!account?.isActive) throw new ProjectAccessDeniedError();
    return {
      available: snapshot.departments.filter((department) =>
        this.policy.canSelectDepartment(account, department.id),
      ),
      selectionRequired: snapshot.departments.length > 0,
    };
  }

  /** Validates the full selection and saves the project, creator and assignments atomically; returns whether the actor can read the created project. */
  public async create(actor: User, input: NewProject): Promise<boolean> {
    const canAccess = await this.repository.transaction(async (repository) => {
      const snapshot = await repository.authorization().snapshot();
      const account = snapshot.accounts.find(
        (entry) => entry.userId === actor.id,
      );
      if (!account || !this.users.has(account, CAPABILITY.MANAGE_PROJECTS))
        throw new ProjectManagementDeniedError();
      const departmentIds = [...new Set(input.departmentIds ?? [])];
      const selection = {
        departmentIds,
        hasDepartments: snapshot.departments.length > 0,
      };
      this.validateInput(input);
      if (selection.hasDepartments && departmentIds.length === 0)
        throw new ProjectDepartmentError("departmentRequired");
      if (
        departmentIds.some(
          (id) =>
            !snapshot.departments.some((department) => department.id === id),
        )
      )
        throw new ProjectDepartmentError("invalidDepartment");
      if (!this.policy.canCreate(account, selection))
        throw new ProjectDepartmentError("departmentOutOfScope");
      await repository.insert({
        ...input,
        name: input.name.trim(),
        description: input.description.trim(),
        ownerId: actor.id,
        departmentIds,
      });
      return this.policy.canAccess(account, departmentIds);
    });
    this.cache.invalidateProjectsList();
    return canAccess;
  }

  private validateInput(input: NewProject): void {
    if (
      !input.name.trim() ||
      input.name.trim().length > 200 ||
      input.description.trim().length > 10_000 ||
      !isProjectStatus(input.status)
    ) {
      throw new Error("Invalid project input.");
    }
  }
}

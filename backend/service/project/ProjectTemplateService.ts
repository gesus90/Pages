import { randomUUID } from "node:crypto";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { ServerCache } from "@/backend/cache/ServerCache";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { ProjectAccessService } from "./ProjectAccessService";
import { ProjectCreationService } from "./ProjectCreationService";

import type {
  NewProject,
  ProjectRepository,
} from "@/backend/database/repositories/ProjectRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { ProjectTemplate } from "@/definition/Project";
import type { User } from "@/definition/User";

/** Saves and instantiates source-bound project templates without copying private aggregates. */
export class ProjectTemplateService {
  private readonly repository: ProjectRepository;
  private readonly cache: ServerCache;
  private readonly policy = new ProjectPolicyService();

  /** Shares source authorization and new-project persistence in one transaction. */
  public constructor(repository: ProjectRepository, cache: ServerCache) {
    this.repository = repository;
    this.cache = cache;
  }

  /** Returns only snapshots whose active or archived source remains currently accessible. */
  public async findAll(actor: User): Promise<ProjectTemplate[]> {
    return this.repository.transaction(async (repository) => {
      const account = await new ProjectAccessService(
        repository,
        this.cache,
      ).account(actor);
      const templates = await repository.findTemplates();
      const visible: ProjectTemplate[] = [];
      for (const template of templates) {
        if (await this.canAccessSource(repository, account, template.projectId))
          visible.push(template);
      }
      return visible;
    });
  }

  /** Creates or refreshes the project's single snapshot using current shared ownership. */
  public async save(actor: User, projectId: string): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const access = new ProjectAccessService(repository, this.cache);
      const project = await access.getById(actor, projectId);
      if (!(await access.canWrite(actor, projectId)))
        throw new ProjectManagementDeniedError();
      const existing = (await repository.findTemplates()).find(
        (template) => template.projectId === projectId,
      );
      await repository.saveTemplate({
        id: existing?.id ?? randomUUID(),
        projectId,
        name: project.name,
        description: project.description,
        status: project.status,
        goals: (await repository.findGoals(projectId)).map(
          (goal) => goal.title,
        ),
        tags: await repository.findTags(projectId),
      });
    });
  }

  /** Instantiates the saved general information with explicit new name and scoped assignments; returns the resulting read grant. */
  public async create(
    actor: User,
    templateId: string,
    input: NewProject,
  ): Promise<boolean> {
    const canAccess = await this.repository.transaction(async (repository) => {
      const account = await new ProjectAccessService(
        repository,
        this.cache,
      ).account(actor);
      const template = (await repository.findTemplates()).find(
        (entry) => entry.id === templateId,
      );
      if (!template) throw new ProjectNotFoundError();
      if (
        !(await this.canAccessSource(repository, account, template.projectId))
      )
        throw new ProjectAccessDeniedError();
      const canOpen = await new ProjectCreationService(
        repository,
        ServerCache.disabled(),
      ).create(actor, {
        ...input,
        description: template.description,
        status: template.status,
      });
      for (const [position, title] of template.goals.entries()) {
        await repository.insertGoal({
          id: randomUUID(),
          projectId: input.id,
          position,
          title,
        });
      }
      await repository.setTags(input.id, template.tags);
      return canOpen;
    });
    this.cache.invalidateProjectsList();
    return canAccess;
  }

  private async canAccessSource(
    repository: ProjectRepository,
    account: AccountAccess,
    projectId: string,
  ): Promise<boolean> {
    const project =
      (await repository.findById(projectId)) ??
      (await repository.findArchivedById(projectId));
    return (
      project !== null &&
      this.policy.canAccess(
        account,
        project.departments.map((department) => department.id),
      )
    );
  }
}

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentError } from "@/backend/error/AgentErrors";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AccountAccess } from "@/definition/Authorization";

/** Live project/wiki authorization for agent references, without visits or provider calls. */
export class AgentContentAccess {
  private readonly projects: ProjectRepository;
  private readonly wikiRepository: WikiRepository;

  public constructor(projects: ProjectRepository, wiki: WikiRepository) {
    this.projects = projects;
    this.wikiRepository = wiki;
  }

  /** Lists only accessible active project names for administration and context selection. */
  public async projectChoices(
    actor: AccountAccess,
  ): Promise<readonly { readonly id: string; readonly name: string }[]> {
    const policy = new ProjectPolicyService();
    return (await this.projects.findAll())
      .filter((project) =>
        policy.canAccess(
          actor,
          project.departments.map((department) => department.id),
        ),
      )
      .map((project) => ({ id: project.id, name: project.name }));
  }

  /** A share or global template does not grant project access, even after scope changes. */
  public async canReadProject(
    actor: AccountAccess,
    projectId: string,
  ): Promise<boolean> {
    const project = await this.projects.findById(projectId);
    return (
      project !== null &&
      new ProjectPolicyService().canAccess(
        actor,
        project.departments.map((department) => department.id),
      )
    );
  }

  /** Resolves the current authorized wiki markdown; private pages stay private for admins. */
  public async wiki(
    actor: AccountAccess,
    pageId: string,
  ): Promise<{
    readonly markdown: string;
    readonly link: string;
    readonly version: string;
  }> {
    if (!actor.isActive)
      throw new AgentError("parameter_reference_unavailable");
    const page = await this.wikiRepository.pages.findVisible(
      {
        userId: actor.userId,
        isAdmin: new UserPolicyService().isAdministrator(actor),
        departmentIds: actor.departments,
        projectIds: (await this.projectChoices(actor)).map(
          (project) => project.id,
        ),
      },
      pageId,
    );
    if (!page) throw new AgentError("parameter_reference_unavailable");
    return {
      markdown: page.content,
      link: `/wiki/${encodeURIComponent(page.id)}`,
      version: String(page.revision),
    };
  }
}

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

/** Lists project names for an agent identity with the unchanged project read policy. */
export class AgentProjectService {
  private readonly repository: ProjectRepository;
  private readonly policy = new ProjectPolicyService();

  public constructor(repository: ProjectRepository) {
    this.repository = repository;
  }

  /**
   * Returns only the names of the active projects the account may read, in Pages' project order.
   *
   * @param userId - Owner of the verified agent credential.
   * @remarks
   * The personal administrator property counts independently of the browser role mode on
   * the MCP path. Every other account is evaluated by the existing project read rules.
   * @throws McpAuthorizationError when the account is missing or inactive.
   */
  public async listNames(userId: string): Promise<string[]> {
    return this.repository.transaction(async (repository) => {
      const snapshot = await repository.authorization().snapshot();
      const found = snapshot.accounts.find((entry) => entry.userId === userId);
      if (!found?.isActive) {
        throw new McpAuthorizationError("invalid_token", 401);
      }
      const account = found.isAdmin
        ? { ...found, mode: "admin" as const }
        : found;
      const activeIds = await repository.findActiveIds();
      const departments = await repository.findDepartmentsByProjects(activeIds);
      const visibleIds = new Set(
        activeIds.filter((id) =>
          this.policy.canAccess(
            account,
            (departments.get(id) ?? []).map((department) => department.id),
          ),
        ),
      );
      return (await repository.findAll())
        .filter((project) => visibleIds.has(project.id))
        .map((project) => project.name);
    });
  }
}

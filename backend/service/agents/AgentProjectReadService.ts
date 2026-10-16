import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import type { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import type {
  AgentProjectDetails,
  AgentProjectList,
  AgentProjectReference,
} from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";

/** Projects visible to a fresh MCP scope, without the application's shared row cache. */
export class AgentProjectReadService {
  private readonly access: Pick<ProjectAccessService, "findAll">;

  public constructor(access: Pick<ProjectAccessService, "findAll">) {
    this.access = access;
  }

  /**
   * Lists the visible active projects by name, for an agent that knows no exact name.
   *
   * @remarks
   * Only identifier, name and status leave the service, at most as many as a
   * resolution offers candidates; `total` counts every visible project.
   */
  public async list(actor: User): Promise<AgentProjectList> {
    const projects = (await this.access.findAll(actor))
      .map(({ id, name, status }) => ({ id, name, status }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
    return {
      projects: projects.slice(0, PAGES_AGENT_LIMITS.candidates),
      total: projects.length,
      truncated: projects.length > PAGES_AGENT_LIMITS.candidates,
    };
  }

  /** Resolves a trimmed, case-sensitive exact name; ambiguity always requires a client choice. */
  public async resolve(
    actor: User,
    name: string,
  ): Promise<AgentProjectReference> {
    const projects = (await this.access.findAll(actor)).filter(
      (project) => project.name === name.trim(),
    );
    const candidates = projects
      .map(({ id, name: projectName }) => ({ id, name: projectName }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const first = candidates[0];
    if (!first) throw new AgentOperationError("NOT_FOUND");
    if (candidates.length > 1)
      throw new AgentOperationError("AMBIGUOUS", {
        candidates: candidates.slice(0, PAGES_AGENT_LIMITS.candidates),
        truncated: candidates.length > PAGES_AGENT_LIMITS.candidates,
      });
    return first;
  }

  /** Reads core fields of an active visible project, with identical missing/hidden failures. */
  public async read(
    actor: User,
    projectId: string,
  ): Promise<AgentProjectDetails> {
    const project = (await this.access.findAll(actor)).find(
      (entry) => entry.id === projectId,
    );
    if (!project) throw new AgentOperationError("NOT_FOUND");
    const { id, name, description, status, progress, startDate, targetDate } =
      project;
    return { id, name, description, status, progress, startDate, targetDate };
  }
}

import { currentProject } from "./McpProjectProjection";

import type {
  McpProject,
  McpProjectNamed,
  McpProjectOverview,
} from "./McpProjectContract";
import type { McpProjectContext } from "./McpProjectContext";

function namedOf(value: McpProjectNamed): McpProjectNamed {
  return { id: value.id, name: value.name };
}

/** Reads the overview and single projects (PAGE-244, interface 1 and 2). */
export class McpProjectReadService {
  /**
   * Lists the projects, templates and departments the account may see.
   *
   * @param context - The request.
   * @param request - Whether the archive is listed instead of the running projects.
   * @returns The overview of the project page, with the departments a new project may receive.
   */
  public async overview(
    context: McpProjectContext,
    request: { readonly isArchived: boolean },
  ): Promise<McpProjectOverview> {
    const { actor, services } = context;
    const { projects } = services;
    const [listed, templates, choices] = await Promise.all([
      request.isArchived
        ? projects.findArchived(actor)
        : projects.findAll(actor),
      projects.findTemplates(actor),
      projects.departmentChoices(actor),
    ]);
    return {
      projects: listed.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
      })),
      templates: templates.map(namedOf),
      departments: choices.available.map(namedOf),
    };
  }

  /**
   * Reads a project, running or archived.
   *
   * @param context - The request.
   * @param projectId - The id of the project.
   * @throws {ProjectNotFoundError} When it does not exist.
   * @throws {ProjectAccessDeniedError} When the account may not see it.
   */
  public async read(
    context: McpProjectContext,
    projectId: string,
  ): Promise<McpProject> {
    return currentProject(context, projectId);
  }
}

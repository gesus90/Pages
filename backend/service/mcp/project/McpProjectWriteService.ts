import { randomUUID } from "node:crypto";

import { getProjectPlaceholderColor } from "@/definition/Project";

import { McpProjectError } from "./McpProjectError";
import { currentProject } from "./McpProjectProjection";

import type { ProjectDetailsUpdate } from "@/backend/database/repositories/ProjectRepository";
import type { Project } from "@/definition/Project";
import type { McpProject, McpProjectNamed } from "./McpProjectContract";
import type { McpProjectContext } from "./McpProjectContext";
import type {
  McpProjectCreateRequest,
  McpProjectIconRequest,
  McpProjectPatchRequest,
} from "./McpProjectRequest";

/** The fields of a change that the details form of the project page saves. */
const DETAIL_FIELDS = [
  "name",
  "description",
  "status",
  "startDate",
  "targetDate",
  "notes",
  "manager",
] as const;

/** The file name the stored icon gets; the API receives no file name. */
const ICON_FILE_NAME = "project-icon";

/**
 * Replaces the stored details with the changed ones and keeps everything else.
 *
 * @remarks
 * The service replaces all details at once, like the project page does.
 */
function detailsOf(
  current: Project,
  request: McpProjectPatchRequest,
  managerId: string | null,
): ProjectDetailsUpdate {
  return {
    name: request.name ?? current.name,
    description: request.description ?? current.description,
    status: request.status ?? current.status,
    notes: request.notes ?? current.notes,
    progress: current.progress,
    managerId,
    startDate:
      request.startDate === undefined ? current.startDate : request.startDate,
    targetDate:
      request.targetDate === undefined
        ? current.targetDate
        : request.targetDate,
  };
}

/** Creates and changes projects (PAGE-244, interface 3, 4, 9 and 10). */
export class McpProjectWriteService {
  /**
   * Creates a project, from a template when the request names one.
   *
   * @param context - The request.
   * @param request - The validated body.
   * @returns The new project.
   * @throws {ProjectManagementDeniedError} Without the right to create projects.
   * @throws {ProjectDepartmentError} For a department outside the account's range,
   * or one the account could not read: the interface answers 201 with the
   * project, so such a project is refused before anything is saved.
   */
  public async create(
    context: McpProjectContext,
    request: McpProjectCreateRequest,
  ): Promise<McpProject> {
    const { actor, services } = context;
    const id = randomUUID();
    const project = {
      id,
      name: request.name,
      description: request.description?.trim() ?? "",
      status: request.status ?? "planned",
      departmentIds: request.departmentIds ?? [],
      ownerId: actor.id,
      placeholderColor: getProjectPlaceholderColor(id),
    };
    const options = { requireReadable: true };
    if (request.templateId === undefined)
      await services.projects.create(actor, project, options);
    else
      await services.projects.createFromTemplate(
        actor,
        request.templateId,
        project,
        options,
      );
    return currentProject(context, id);
  }

  /**
   * Changes the named fields of a running project and nothing else.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param request - The validated body with at least one field.
   * @returns The changed project.
   *
   * @remarks
   * Details, tags and departments go through the service methods of the
   * project page; the departments last, as they can change who sees it.
   */
  public async patch(
    context: McpProjectContext,
    projectId: string,
    request: McpProjectPatchRequest,
  ): Promise<McpProject> {
    const { actor, services } = context;
    const current = await services.projects.getById(actor, projectId);
    if (DETAIL_FIELDS.some((field) => request[field] !== undefined)) {
      const managerId =
        request.manager === undefined
          ? current.managerId
          : await this.managerId(context, projectId, request.manager);
      await services.projects.updateDetails(
        actor,
        projectId,
        detailsOf(current, request, managerId),
      );
    }
    if (request.tags !== undefined)
      await services.projects.setTags(actor, projectId, request.tags);
    if (request.departmentIds !== undefined) {
      await services.projects.setDepartments(
        actor,
        projectId,
        request.departmentIds,
      );
      context.announceAccessChange(projectId);
    }
    return currentProject(context, projectId);
  }

  /**
   * Saves the project as its template, or refreshes the template it has.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @returns The template.
   */
  public async saveTemplate(
    context: McpProjectContext,
    projectId: string,
  ): Promise<McpProjectNamed> {
    const { actor, services } = context;
    await services.projects.saveTemplate(actor, projectId);
    const template = (await services.projects.findTemplates(actor)).find(
      (entry) => entry.projectId === projectId,
    );
    if (!template) throw new McpProjectError("not_found");
    return { id: template.id, name: template.name };
  }

  /**
   * Replaces the icon of a running project.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param icon - The decoded image.
   * @returns The changed project.
   */
  public async replaceIcon(
    context: McpProjectContext,
    projectId: string,
    icon: McpProjectIconRequest,
  ): Promise<McpProject> {
    await context.services.projects.replaceIcon(context.actor, projectId, {
      data: icon.data,
      filename: ICON_FILE_NAME,
      mimeType: icon.mimeType,
    });
    return currentProject(context, projectId);
  }

  /**
   * Resolves the project manager of a change.
   *
   * @throws {McpProjectError} `not_found` for an unknown or hidden person,
   * `invalid_request` for a visible person outside the team, whom the
   * service would refuse as manager.
   */
  private async managerId(
    context: McpProjectContext,
    projectId: string,
    username: string | null,
  ): Promise<string | null> {
    if (username === null) return null;
    const member = await context.findMember(projectId, username);
    if (member !== null) return member;
    await context.requireCandidate(projectId, username);
    throw new McpProjectError("invalid_request");
  }
}

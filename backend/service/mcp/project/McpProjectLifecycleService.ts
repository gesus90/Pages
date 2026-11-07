import { McpProjectError } from "./McpProjectError";

import type {
  McpProjectArchiveQuestion,
  McpProjectDeletionQuestion,
} from "./McpProjectContract";
import type { McpProjectContext } from "./McpProjectContext";
import type { McpProjectConfirmation } from "./McpProjectRequest";

/**
 * Archives and permanently deletes projects; administrators only (PAGE-244, interface 12 and 13).
 *
 * @remarks
 * Without `confirmed: true` nothing changes and the client receives the
 * question with the scope. No confirmation word is asked for or read.
 */
export class McpProjectLifecycleService {
  /**
   * Archives a running project after the client confirmed it.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param request - The confirmation.
   * @returns The question naming the project, or the archive.
   * @throws {McpProjectError} `forbidden` for an account that is no administrator.
   */
  public async archive(
    context: McpProjectContext,
    projectId: string,
    request: McpProjectConfirmation,
  ): Promise<McpProjectArchiveQuestion | { readonly archived: true }> {
    const { actor, services } = context;
    const project = await services.projects.getById(actor, projectId);
    const { canArchive } = await services.projects.permissions(
      actor,
      projectId,
    );
    if (!canArchive) throw new McpProjectError("forbidden");
    if (request.confirmed !== true)
      return {
        confirmationRequired: true,
        project: { id: project.id, name: project.name, status: project.status },
      };
    await services.projects.archive(actor, projectId);
    context.announceAccessChange(projectId);
    return { archived: true };
  }

  /**
   * Deletes a running or archived project for good after the client confirmed the scope.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param request - The confirmation.
   * @returns The question with the scope of the deletion, or the deletion.
   * @throws {ProjectManagementDeniedError} For an account that is no administrator.
   */
  public async delete(
    context: McpProjectContext,
    projectId: string,
    request: McpProjectConfirmation,
  ): Promise<McpProjectDeletionQuestion | { readonly deleted: true }> {
    const { actor, services } = context;
    if (request.confirmed !== true)
      return {
        confirmationRequired: true,
        scope: await services.projects.describeDeletion(actor, projectId),
      };
    await services.projects.deletePermanently(actor, projectId);
    context.announceAccessChange(projectId);
    return { deleted: true };
  }
}

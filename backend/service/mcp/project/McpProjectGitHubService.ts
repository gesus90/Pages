import { McpProjectError } from "./McpProjectError";
import { currentProject } from "./McpProjectProjection";

import type {
  McpProject,
  McpProjectConnectionAnswer,
  McpProjectSyncAnswer,
} from "./McpProjectContract";
import type { McpProjectContext } from "./McpProjectContext";
import type { McpProjectGitHubRequest } from "./McpProjectRequest";

/**
 * Saves, tests, synchronizes and removes the GitHub connection (PAGE-244, interface 11).
 *
 * @remarks
 * The token goes to `saveIntegration` only, which stores it encrypted; no
 * answer, activity entry or error of this service carries it.
 */
export class McpProjectGitHubService {
  /**
   * Saves the connection; without a token the stored one stays.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param request - The validated settings.
   * @returns The changed project.
   */
  public async save(
    context: McpProjectContext,
    projectId: string,
    request: McpProjectGitHubRequest,
  ): Promise<McpProject> {
    await context.requireVisible(projectId);
    await context.services.projects.saveIntegration(context.actor, projectId, {
      repoUrl: request.repoUrl,
      // An empty token keeps the stored secret, like an empty form field.
      token: request.token ?? "",
      syncIssues: request.syncIssues,
      syncStatus: request.syncStatus,
      syncComments: request.syncComments,
      syncPullRequests: request.syncPullRequests,
      syncCommits: request.syncCommits,
      syncDirection: request.syncDirection,
      syncIntervalMinutes: request.syncIntervalMinutes,
    });
    return currentProject(context, projectId);
  }

  /**
   * Checks whether the stored settings reach the repository.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @returns The outcome and the project with the noted result.
   */
  public async test(
    context: McpProjectContext,
    projectId: string,
  ): Promise<McpProjectConnectionAnswer> {
    await this.requireConnection(context, projectId);
    const isConnected = await context.services.gitHub.testConnection(
      context.actor,
      projectId,
    );
    return { isConnected, project: await currentProject(context, projectId) };
  }

  /**
   * Synchronizes the project with GitHub right away.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @returns The counters of the run, as the project page receives them, and the project.
   */
  public async sync(
    context: McpProjectContext,
    projectId: string,
  ): Promise<McpProjectSyncAnswer> {
    await this.requireConnection(context, projectId);
    const summary = await context.services.gitHub.syncProjectNow(
      context.actor,
      projectId,
    );
    return { summary, project: await currentProject(context, projectId) };
  }

  /**
   * Switches the automatic synchronization on or off.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param isEnabled - Whether synchronization runs.
   * @returns The changed project.
   */
  public async setSyncEnabled(
    context: McpProjectContext,
    projectId: string,
    isEnabled: boolean,
  ): Promise<McpProject> {
    await this.requireConnection(context, projectId);
    const integration =
      await context.services.projects.setIntegrationSyncEnabled(
        context.actor,
        projectId,
        isEnabled,
      );
    if (integration === null) throw new McpProjectError("not_found");
    return currentProject(context, projectId);
  }

  /**
   * Removes the connection together with the stored token.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @returns The changed project.
   */
  public async disconnect(
    context: McpProjectContext,
    projectId: string,
  ): Promise<McpProject> {
    await this.requireConnection(context, projectId);
    await context.services.projects.disconnectIntegration(
      context.actor,
      projectId,
    );
    return currentProject(context, projectId);
  }

  /**
   * Requires a stored connection of a project the account can see.
   *
   * @throws {McpProjectError} `not_found` when the project has none.
   */
  private async requireConnection(
    context: McpProjectContext,
    projectId: string,
  ): Promise<void> {
    const integration = await context.services.projects.findIntegration(
      context.actor,
      projectId,
    );
    if (integration === null) throw new McpProjectError("not_found");
  }
}

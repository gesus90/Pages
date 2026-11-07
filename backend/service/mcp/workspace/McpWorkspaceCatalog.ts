import { AgentError } from "@/backend/error/AgentErrors";

import { hideInvisibleProject, McpWorkspaceError } from "./McpWorkspaceError";

import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import type { AgentWorkspaceView } from "@/definition/AgentWorkspace";
import type { RemoteWorkspaceView } from "@/definition/RemoteConnection";

/**
 * The services of the interface the workspace API calls.
 *
 * @remarks
 * The API adds no business logic and no right of its own; every call goes
 * through these services with the paired account as the actor.
 */
export interface McpWorkspaceServices {
  readonly local: AgentWorkspaceService;
  readonly remote: RemoteWorkspaceService;
  readonly connections: RemoteConnectionService;
}

/** A workspace of either kind with the view its service gave. */
export type McpStoredWorkspace =
  | { readonly kind: "local"; readonly view: AgentWorkspaceView }
  | { readonly kind: "remote"; readonly view: RemoteWorkspaceView };

/** What a listing narrows to. */
export interface McpWorkspaceFilter {
  readonly projectId: string | null;
  readonly kind: "local" | "remote" | null;
}

/**
 * Remote profiles of a project that is gone stay out, as for local ones:
 * the interface lists only workspaces of projects the account can open.
 */
function isListed(view: RemoteWorkspaceView): boolean {
  return view.reason !== "project_unavailable";
}

/**
 * Finds workspaces of both kinds the way the services of the interface show them.
 *
 * @remarks
 * Visibility is decided by those services: a workspace the account cannot
 * see is not found, exactly like one that does not exist.
 */
export class McpWorkspaceCatalog {
  private readonly services: McpWorkspaceServices;

  /**
   * Creates the catalog.
   *
   * @param services - The workspace and connection services, already on the MCP channel.
   */
  public constructor(services: McpWorkspaceServices) {
    this.services = services;
  }

  /**
   * Lists the workspaces the account may open, local ones first.
   *
   * @param userId - The paired account.
   * @param filter - The project and kind to narrow to.
   * @throws {McpWorkspaceError} `not_found` for a project the account cannot see.
   */
  public async list(
    userId: string,
    filter: McpWorkspaceFilter,
  ): Promise<readonly McpStoredWorkspace[]> {
    const local =
      filter.kind === "remote"
        ? []
        : await this.listLocal(userId, filter.projectId);
    const remote =
      filter.kind === "local"
        ? []
        : await this.listRemote(userId, filter.projectId);
    return [...local, ...remote];
  }

  /**
   * Finds one workspace by identifier.
   *
   * @param userId - The paired account.
   * @param id - The identifier of the workspace.
   * @throws {McpWorkspaceError} `not_found` for a missing or hidden workspace.
   */
  public async find(userId: string, id: string): Promise<McpStoredWorkspace> {
    try {
      return {
        kind: "local",
        view: await this.services.local.read(userId, id),
      };
    } catch (error: unknown) {
      if (
        !(error instanceof AgentError) ||
        error.code !== "workspace_not_found"
      )
        throw error;
    }
    const view = (await this.services.remote.list(userId)).find(
      (entry) => entry.id === id && isListed(entry),
    );
    if (view === undefined) throw new McpWorkspaceError("not_found");
    return { kind: "remote", view };
  }

  /**
   * Rechecks that the account can open a project the request names.
   *
   * @param userId - The paired account.
   * @param projectId - The project of the request.
   * @throws {McpWorkspaceError} `not_found` for a hidden or missing project.
   */
  public async requireProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    await hideInvisibleProject(() =>
      this.services.local.requireProjectAccess(userId, projectId),
    );
  }

  /**
   * Rechecks that the account may use a connection the request names.
   *
   * @param userId - The paired account.
   * @param connectionId - The connection of the request.
   * @throws {McpWorkspaceError} `not_found` for a hidden or missing connection.
   */
  public async requireConnection(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const scope = await this.services.connections.scope(userId);
    if (!scope.connections.some((entry) => entry.id === connectionId))
      throw new McpWorkspaceError("not_found");
  }

  private async listLocal(
    userId: string,
    projectId: string | null,
  ): Promise<readonly McpStoredWorkspace[]> {
    const views = await hideInvisibleProject(() =>
      this.services.local.list(userId, projectId),
    );
    return views.map((view) => ({ kind: "local", view }));
  }

  private async listRemote(
    userId: string,
    projectId: string | null,
  ): Promise<readonly McpStoredWorkspace[]> {
    if (projectId !== null) await this.requireProject(userId, projectId);
    const views = await this.services.remote.list(userId);
    return views
      .filter(
        (view) =>
          isListed(view) &&
          (projectId === null || view.projectId === projectId),
      )
      .map((view) => ({ kind: "remote", view }));
  }
}

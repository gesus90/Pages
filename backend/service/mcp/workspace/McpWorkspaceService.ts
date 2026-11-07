import { hideInvisibleProject, McpWorkspaceError } from "./McpWorkspaceError";
import { McpWorkspaceCatalog } from "./McpWorkspaceCatalog";
import {
  projectFolders,
  projectUsage,
  projectWorkspace,
} from "./McpWorkspaceProjection";

import type { AgentWorkspaceUsage } from "@/definition/AgentWorkspace";
import type {
  McpStoredWorkspace,
  McpWorkspaceServices,
} from "./McpWorkspaceCatalog";
import type {
  McpFolderListingResponse,
  McpWorkspaceRemovalQuestion,
  McpWorkspaceResponse,
  McpWorkspaceUsageResponse,
} from "./McpWorkspaceContract";
import type {
  McpFolderRequest,
  McpRemovalRequest,
  McpWorkspaceCreateRequest,
  McpWorkspaceListRequest,
  McpWorkspaceUpdateRequest,
} from "./McpWorkspaceRequest";

/** The longest path the interface takes. */
const MAXIMUM_PATH_LENGTH = 4096;

/** What a change of a workspace sends to the services of the interface. */
interface WorkspaceInput {
  readonly name: string;
  readonly path: string;
  readonly projectId: string;
  readonly revision?: number;
}

/**
 * Manages local and remote agent workspaces for a paired machine.
 *
 * @remarks
 * Every call runs through the workspace services of the interface on the MCP
 * channel, which decide who may see, register, change or remove a workspace.
 * This class only reads the kind of a workspace, asks before a removal, and
 * shapes the answers. Removing a workspace never deletes a directory.
 */
export class McpWorkspaceService {
  private readonly services: McpWorkspaceServices;
  private readonly catalog: McpWorkspaceCatalog;

  /**
   * Creates the service.
   *
   * @param services - The workspace and connection services, already on the MCP channel.
   */
  public constructor(services: McpWorkspaceServices) {
    this.services = services;
    this.catalog = new McpWorkspaceCatalog(services);
  }

  /**
   * Lists the workspaces of projects the account may open.
   *
   * @param userId - The paired account.
   * @param query - The optional project and kind to narrow to.
   * @throws {McpWorkspaceError} `not_found` for a project the account cannot see.
   */
  public async list(
    userId: string,
    query: McpWorkspaceListRequest,
  ): Promise<{ readonly workspaces: readonly McpWorkspaceResponse[] }> {
    const stored = await this.catalog.list(userId, {
      projectId: query.projectId ?? null,
      kind: query.kind ?? null,
    });
    return { workspaces: stored.map(projectWorkspace) };
  }

  /**
   * Reads one workspace.
   *
   * @param userId - The paired account.
   * @param id - The workspace.
   * @throws {McpWorkspaceError} `not_found` for a missing or hidden workspace.
   */
  public async read(
    userId: string,
    id: string,
  ): Promise<{ readonly workspace: McpWorkspaceResponse }> {
    return { workspace: projectWorkspace(await this.catalog.find(userId, id)) };
  }

  /**
   * Registers a workspace; the directory is checked first and stored canonically.
   *
   * @param userId - The paired account, who becomes the registering person.
   * @param request - Kind, name, path, project and, for a remote workspace, the connection.
   * @throws {McpWorkspaceError} `check_failed` with the finding for a remote
   * directory that cannot serve, `path_invalid` for a local one.
   */
  public async create(
    userId: string,
    request: McpWorkspaceCreateRequest,
  ): Promise<{ readonly workspace: McpWorkspaceResponse }> {
    const id =
      request.kind === "local"
        ? await this.createLocal(userId, request)
        : await this.createRemote(userId, request);
    return this.read(userId, id);
  }

  /**
   * Changes a workspace; missing fields keep their stored value.
   *
   * @remarks
   * The kind cannot change and neither can the connection of a remote
   * workspace. The path is checked again like for a new workspace.
   *
   * @param userId - The paired account.
   * @param id - The workspace.
   * @param request - The fields to change with the revision read before.
   * @throws {McpWorkspaceError} `conflict` for a stale revision, `invalid_request`
   * for a connection on a local workspace or another connection on a remote one.
   */
  public async update(
    userId: string,
    id: string,
    request: McpWorkspaceUpdateRequest,
  ): Promise<{ readonly workspace: McpWorkspaceResponse }> {
    const stored = await this.catalog.find(userId, id);
    if (stored.view.revision !== request.revision)
      throw new McpWorkspaceError("conflict");
    const proposed: WorkspaceInput = {
      name: request.name ?? stored.view.name,
      path: request.path ?? stored.view.path,
      projectId: request.projectId ?? stored.view.projectId,
      revision: request.revision,
    };
    if (request.projectId !== undefined)
      await this.catalog.requireProject(userId, request.projectId);
    if (stored.kind === "local") {
      if (request.connectionId !== undefined)
        throw new McpWorkspaceError("invalid_request");
      await hideInvisibleProject(() =>
        this.services.local.save(userId, id, proposed),
      );
    } else {
      this.requireSameConnection(stored, request.connectionId);
      await this.services.remote.save(userId, id, {
        ...proposed,
        connectionId: stored.view.connectionId,
      });
    }
    return this.read(userId, id);
  }

  /**
   * Checks the directory of a remote workspace again over SSH and stores the result.
   *
   * @param userId - The paired account.
   * @param id - The workspace.
   * @throws {McpWorkspaceError} `invalid_request` for a local workspace,
   * `check_failed` or `connection_unavailable` when the connection could not run the check.
   */
  public async check(
    userId: string,
    id: string,
  ): Promise<{ readonly workspace: McpWorkspaceResponse }> {
    const stored = await this.catalog.find(userId, id);
    if (stored.kind === "local") throw new McpWorkspaceError("invalid_request");
    await this.services.remote.check(userId, id);
    return this.read(userId, id);
  }

  /**
   * Lists what still refers to a workspace.
   *
   * @param userId - The paired account; names are only given to administrators.
   * @param id - The workspace.
   */
  public async usages(
    userId: string,
    id: string,
  ): Promise<{ readonly usages: readonly McpWorkspaceUsageResponse[] }> {
    const usages = await this.usagesOf(
      userId,
      await this.catalog.find(userId, id),
    );
    return { usages: usages.map(projectUsage) };
  }

  /**
   * Removes the registration of a workspace after a confirmation.
   *
   * @remarks
   * Only the entry in Pages goes; the directory stays. References of agents
   * and plans are detached by the registry, which also refuses while an
   * affected plan runs.
   *
   * @param userId - The paired account.
   * @param id - The workspace.
   * @param request - The revision read before and the confirmation.
   * @throws {McpWorkspaceError} `conflict` for a stale revision, `running` while an
   * affected plan runs.
   */
  public async remove(
    userId: string,
    id: string,
    request: McpRemovalRequest,
  ): Promise<McpWorkspaceRemovalQuestion | { readonly removed: true }> {
    const stored = await this.catalog.find(userId, id);
    if (request.confirmed === true) {
      await this.removeStored(userId, stored, request.revision);
      return { removed: true };
    }
    // Listing the usages asks for the same right as the removal itself.
    const usages = await this.usagesOf(userId, stored);
    if (stored.view.revision !== request.revision)
      throw new McpWorkspaceError("conflict");
    return {
      confirmationRequired: true,
      workspace: {
        id: stored.view.id,
        name: stored.view.name,
        path: stored.view.path,
      },
      usages: usages.map(projectUsage),
    };
  }

  /**
   * Lists the directories of the server a local workspace could use.
   *
   * @param userId - A paired account that manages a project or administers.
   * @param query - The level to list and whether hidden directories show.
   * @throws {McpWorkspaceError} `path_invalid` for a path above the length limit.
   */
  public async folders(
    userId: string,
    query: McpFolderRequest,
  ): Promise<McpFolderListingResponse> {
    const path = query.path ?? null;
    if (path !== null && path.length > MAXIMUM_PATH_LENGTH)
      throw new McpWorkspaceError("path_invalid", "invalid");
    return projectFolders(
      await this.services.local.folders(userId, {
        path,
        showHidden: query.showHidden === "1",
      }),
    );
  }

  private async createLocal(
    userId: string,
    request: Extract<McpWorkspaceCreateRequest, { kind: "local" }>,
  ): Promise<string> {
    return hideInvisibleProject(() =>
      this.services.local.save(userId, null, {
        name: request.name,
        path: request.path,
        projectId: request.projectId,
      }),
    );
  }

  private async createRemote(
    userId: string,
    request: Extract<McpWorkspaceCreateRequest, { kind: "remote" }>,
  ): Promise<string> {
    await this.catalog.requireProject(userId, request.projectId);
    await this.catalog.requireConnection(userId, request.connectionId);
    return this.services.remote.save(userId, null, {
      name: request.name,
      connectionId: request.connectionId,
      path: request.path,
      projectId: request.projectId,
    });
  }

  private requireSameConnection(
    stored: Extract<McpStoredWorkspace, { kind: "remote" }>,
    connectionId: string | undefined,
  ): void {
    if (connectionId !== undefined && connectionId !== stored.view.connectionId)
      throw new McpWorkspaceError("invalid_request");
  }

  private async usagesOf(
    userId: string,
    stored: McpStoredWorkspace,
  ): Promise<readonly AgentWorkspaceUsage[]> {
    const { local, remote } = this.services;
    return stored.kind === "local"
      ? local.usages(userId, stored.view.id)
      : remote.usages(userId, stored.view.id);
  }

  private async removeStored(
    userId: string,
    stored: McpStoredWorkspace,
    revision: number,
  ): Promise<void> {
    const { local, remote } = this.services;
    if (stored.kind === "local")
      await local.remove(userId, stored.view.id, revision);
    else await remote.remove(userId, stored.view.id, revision);
  }
}

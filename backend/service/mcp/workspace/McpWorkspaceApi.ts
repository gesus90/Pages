import { McpConnectionService } from "./McpConnectionService";
import { McpWorkspaceError } from "./McpWorkspaceError";
import { McpWorkspaceService } from "./McpWorkspaceService";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { McpWorkspaceServices } from "./McpWorkspaceCatalog";

/** What the workspace API needs beyond the services: the token check and the accounts. */
export interface McpWorkspaceAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/** The account a device token acts for. */
export interface McpWorkspaceActor {
  readonly userId: string;
}

/**
 * The workspace and connection API of the stand-alone Pages MCP program (PAGE-245).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use, and every call then runs through the same
 * services as the page "Arbeitsverzeichnisse" with that account as the actor.
 * The services run on the `mcp` channel, like the other MCP access: an
 * account with the administrator role acts as an administrator without the
 * admin mode of the interface. The interface itself stays on the `ui` channel.
 */
export class McpWorkspaceApi {
  public readonly workspaces: McpWorkspaceService;
  public readonly connections: McpConnectionService;
  private readonly access: McpWorkspaceAccess;

  /**
   * Creates the API.
   *
   * @param services - The services of the interface, whichever channel they were built for.
   * @param access - The device token check and the account lookup.
   */
  public constructor(
    services: McpWorkspaceServices,
    access: McpWorkspaceAccess,
  ) {
    const channelServices: McpWorkspaceServices = {
      local: services.local.forChannel("mcp"),
      remote: services.remote.forChannel("mcp"),
      connections: services.connections.forChannel("mcp"),
    };
    this.workspaces = new McpWorkspaceService(channelServices);
    this.connections = new McpConnectionService(channelServices);
    this.access = access;
  }

  /**
   * Checks the token of a request and names the account it acts for.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The paired account as the actor.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpWorkspaceError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpWorkspaceActor> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpWorkspaceError("invalid_token");
    return { userId: account.id };
  }
}

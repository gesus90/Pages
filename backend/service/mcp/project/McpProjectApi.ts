import { McpProjectContext } from "./McpProjectContext";
import { McpProjectError } from "./McpProjectError";
import { McpProjectGitHubService } from "./McpProjectGitHubService";
import { McpProjectLifecycleService } from "./McpProjectLifecycleService";
import { McpProjectPlanningService } from "./McpProjectPlanningService";
import { McpProjectReadService } from "./McpProjectReadService";
import { McpProjectWriteService } from "./McpProjectWriteService";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { McpProjectDependencies } from "./McpProjectContext";

/** What the project API needs beyond the project services: the token check and the accounts. */
export interface McpProjectAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/**
 * The project API of the stand-alone Pages MCP program (PAGE-244).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use, and every call then runs through the
 * project services of the interface with that account as the actor.
 */
export class McpProjectApi {
  public readonly reads = new McpProjectReadService();
  public readonly writes = new McpProjectWriteService();
  public readonly planning = new McpProjectPlanningService();
  public readonly gitHub = new McpProjectGitHubService();
  public readonly lifecycle = new McpProjectLifecycleService();
  private readonly services: McpProjectDependencies;
  private readonly access: McpProjectAccess;

  /**
   * Creates the API.
   *
   * @param services - The project services of the interface.
   * @param access - The device token check and the account lookup.
   */
  public constructor(
    services: McpProjectDependencies,
    access: McpProjectAccess,
  ) {
    this.services = services;
    this.access = access;
  }

  /**
   * Checks the token of a request and opens its context.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The context with the paired account as the actor.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpProjectError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpProjectContext> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpProjectError("invalid_token");
    return new McpProjectContext(account, this.services);
  }
}

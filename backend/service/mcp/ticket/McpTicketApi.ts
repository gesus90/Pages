import { McpTicketCatalogService } from "./McpTicketCatalogService";
import { McpTicketContext } from "./McpTicketContext";
import { McpTicketDetailService } from "./McpTicketDetailService";
import { McpTicketError } from "./McpTicketError";
import { McpTicketLifecycleService } from "./McpTicketLifecycleService";
import { McpTicketReadService } from "./McpTicketReadService";
import { McpTicketWriteService } from "./McpTicketWriteService";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { McpTicketDependencies } from "./McpTicketContext";

/** What the ticket API needs beyond the ticket services: the token check and the accounts. */
export interface McpTicketAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/**
 * The ticket API of the stand-alone Pages MCP program (PAGE-242).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use, and every call then runs through the
 * ticket services of the interface with that account as the actor.
 */
export class McpTicketApi {
  public readonly reads = new McpTicketReadService();
  public readonly writes = new McpTicketWriteService();
  public readonly details = new McpTicketDetailService();
  public readonly lifecycle = new McpTicketLifecycleService();
  public readonly catalog = new McpTicketCatalogService();
  private readonly services: McpTicketDependencies;
  private readonly access: McpTicketAccess;

  /**
   * Creates the API.
   *
   * @param services - The ticket services of the interface.
   * @param access - The device token check and the account lookup.
   */
  public constructor(services: McpTicketDependencies, access: McpTicketAccess) {
    this.services = services;
    this.access = access;
  }

  /**
   * Checks the token of a request and opens its context.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The context with the paired account as the actor.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpTicketError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpTicketContext> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpTicketError("invalid_token");
    return new McpTicketContext(account, this.services);
  }
}

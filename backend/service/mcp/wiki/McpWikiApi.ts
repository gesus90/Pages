import { McpWikiContext } from "./McpWikiContext";
import { McpWikiDetailService } from "./McpWikiDetailService";
import { McpWikiError } from "./McpWikiError";
import { McpWikiLifecycleService } from "./McpWikiLifecycleService";
import { McpWikiPageService } from "./McpWikiPageService";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { McpWikiDependencies } from "./McpWikiContext";

/** What the wiki API needs beyond the wiki service: the token check and the accounts. */
export interface McpWikiAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/**
 * The wiki API of the stand-alone Pages MCP program (PAGE-257).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use, and every call then runs through the
 * announcing wiki service of the interface with that account as the actor.
 */
export class McpWikiApi {
  public readonly pages = new McpWikiPageService();
  public readonly lifecycle = new McpWikiLifecycleService();
  public readonly details = new McpWikiDetailService();
  private readonly services: McpWikiDependencies;
  private readonly access: McpWikiAccess;

  /**
   * Creates the API.
   *
   * @param services - The wiki service of the interface and its companions.
   * @param access - The device token check and the account lookup.
   */
  public constructor(services: McpWikiDependencies, access: McpWikiAccess) {
    this.services = services;
    this.access = access;
  }

  /**
   * Checks the token of a request and opens its context.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The context with the paired account as the actor.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpWikiError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpWikiContext> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpWikiError("invalid_token");
    return new McpWikiContext(account, this.services);
  }
}

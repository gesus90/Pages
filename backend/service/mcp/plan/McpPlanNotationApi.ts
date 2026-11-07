import { McpPlanNotationError } from "./McpPlanNotationError";
import { McpPlanNotationService } from "./McpPlanNotationService";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";
import type { McpPlanNotationDependencies } from "./McpPlanNotationCatalogs";

/** What the plan notation API needs beyond the services: the token check and the accounts. */
export interface McpPlanNotationAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/**
 * The plan notation API of the stand-alone Pages MCP program (PAGE-250).
 *
 * @remarks
 * A paired machine writes, reads, checks and lays out agent plans as text,
 * a subset of Graphviz DOT. It acts with the rights of the account that
 * confirmed the pairing: every request checks the token again with the
 * unchanged check of the device API, and every call then runs through the
 * plan service of the plan page with that account as the actor, so the
 * plan service decides about reading, changing and saving exactly as for
 * `save-plan`. The plan service is bound to the `mcp` channel
 * (`accountForChannel`): an administrator acts as one without switching on
 * the admin mode of the interface.
 */
export class McpPlanNotationApi {
  public readonly plans: McpPlanNotationService;
  private readonly access: McpPlanNotationAccess;

  /**
   * Creates the API.
   *
   * @param services - The plan service of the `mcp` channel and the wiki.
   * @param access - The device token check and the account lookup.
   */
  public constructor(
    services: McpPlanNotationDependencies,
    access: McpPlanNotationAccess,
  ) {
    this.plans = new McpPlanNotationService(services);
    this.access = access;
  }

  /**
   * Checks the token of a request and names the account it acts for.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The paired account.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpPlanNotationError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(authorization: string | null): Promise<User> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpPlanNotationError("invalid_token");
    return account;
  }
}

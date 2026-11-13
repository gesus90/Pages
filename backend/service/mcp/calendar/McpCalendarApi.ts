import { McpCalendarContext } from "./McpCalendarContext";
import { McpCalendarError } from "./McpCalendarError";
import { McpCalendarLifecycleService } from "./McpCalendarLifecycleService";
import { McpCalendarReadService } from "./McpCalendarReadService";
import { McpCalendarWriteService } from "./McpCalendarWriteService";

import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type { McpCalendarService } from "./McpCalendarContext";

/** The stored access of agent accounts; `null` for a person. */
export interface McpCalendarAgentDirectory {
  find(
    userId: string,
  ): Promise<{ readonly access: AgentEmployeeAccess } | null>;
}

/** What the calendar API needs beyond the calendar: the token check, the accounts and the agents. */
export interface McpCalendarAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
  readonly agents: McpCalendarAgentDirectory;
}

/**
 * The calendar API of the stand-alone Pages MCP program (PAGE-301).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, noting its use, and every call then runs through the
 * calendar service of the interface with that account as the actor. An
 * agent account whose access is "read only" may read but change nothing.
 */
export class McpCalendarApi {
  public readonly reads = new McpCalendarReadService();
  public readonly writes = new McpCalendarWriteService();
  public readonly lifecycle = new McpCalendarLifecycleService();
  private readonly calendar: McpCalendarService;
  private readonly access: McpCalendarAccess;

  /**
   * Creates the API.
   *
   * @param calendar - The calendar service of the interface.
   * @param access - The device token check, the account lookup and the agents.
   */
  public constructor(calendar: McpCalendarService, access: McpCalendarAccess) {
    this.calendar = calendar;
    this.access = access;
  }

  /**
   * Checks the token of a request and opens its context.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The context with the paired account as the actor.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpCalendarError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpCalendarContext> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpCalendarError("invalid_token");
    return new McpCalendarContext({
      actor: account,
      isReadOnly: await this.isReadOnly(account),
      calendar: this.calendar,
    });
  }

  /**
   * Whether an account may only read: an agent with the access "read only".
   *
   * @remarks
   * An agent without a stored access counts as "read only", the default of
   * the agent administration.
   */
  private async isReadOnly(account: User): Promise<boolean> {
    if (account.isAgent !== true) return false;
    const employee = await this.access.agents.find(account.id);
    return (employee?.access ?? "read_only") === "read_only";
  }
}

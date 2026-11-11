import { McpAgentError } from "./McpAgentError";
import { McpAgentService } from "./McpAgentService";

import type { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import type { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";

/** What the agent API needs beyond the administration: the token check and the accounts. */
export interface McpAgentAccess {
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
}

/** The administrator a device token acts for. */
export interface McpAgentActor {
  readonly userId: string;
}

/**
 * The agent API of the stand-alone Pages MCP program (PAGE-267).
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Every request checks the token again with the unchanged check of
 * the device API, and then requires the administrator role of that account,
 * on the existing administration routes: anyone else gets `forbidden`, even
 * for an agent known from the chat. Deletion routes use the separate deletion
 * service, which also admits the Verwaltung role when it exists. Both run on
 * the `mcp` channel, so an administrator need not switch the browser mode.
 */
export class McpAgentApi {
  public readonly agents: McpAgentService;
  public readonly deletions: AgentDeletionService;
  private readonly administration: AgentEmployeeAdministration;
  private readonly access: McpAgentAccess;

  /**
   * Creates the API.
   *
   * @param administration - The administration of agents of the interface, whichever channel it was built for.
   * @param access - The device token check and the account lookup.
   * @param templates - The stored templates of `AGENT.md` of the instance.
   */
  public constructor(
    administration: AgentEmployeeAdministration,
    access: McpAgentAccess,
    templates: AgentTemplateService,
    deletions: AgentDeletionService,
  ) {
    this.administration = administration.forChannel("mcp");
    this.agents = new McpAgentService(
      this.administration,
      templates.forChannel("mcp"),
    );
    this.access = access;
    this.deletions = deletions.forChannel("mcp");
  }

  /**
   * Checks the token of a request and requires an administrator behind it.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The paired administrator as the actor.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpAgentError} `invalid_token` when the account is gone or
   * deactivated, `forbidden` without the administrator role.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpAgentActor> {
    const actor = await this.authenticateDeletion(authorization);
    await this.administration.requireAdministrator(actor.userId);
    return actor;
  }

  /** Authenticates a paired account; deletion authorization follows in its service. */
  public async authenticateDeletion(
    authorization: string | null,
  ): Promise<McpAgentActor> {
    const identity = await this.access.devices.authenticate(authorization);
    const credentials = await this.access.accounts.findCredentialsByUsername(
      identity.account.username,
    );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpAgentError("invalid_token");
    return { userId: account.id };
  }
}

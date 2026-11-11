import { AgentProfileError } from "@/backend/error/AgentProfileError";

import { McpAgentError } from "./McpAgentError";

import type { UserService } from "@/backend/service/UserService";
import type { AgentProfileReadService } from "@/backend/service/employee/profile/AgentProfileReadService";
import type { McpDeviceService } from "@/backend/service/mcp/McpDeviceService";

/** What the profile API is built from. */
export interface McpAgentProfileDependencies {
  readonly accounts: Pick<UserService, "findCredentialsByUsername">;
  readonly devices: Pick<McpDeviceService, "authenticate">;
  readonly profiles: AgentProfileReadService;
}

/** The account a device token acts for. */
export interface McpAgentProfileActor {
  readonly userId: string;
}

/**
 * The read API of agent profiles and groups of the stand-alone Pages MCP
 * program (PAGE-308): `agents_list`, `agents_read` and `groups_read`.
 *
 * @remarks
 * A paired machine acts with the rights of the account that confirmed the
 * pairing. Unlike the administration of agents, the profile reads admit every
 * active account; what an account reads is decided by the same service the
 * user interface reads through, on the `mcp` channel. Every request checks
 * the token and the account again.
 */
export class McpAgentProfileApi {
  public readonly profiles: AgentProfileReadService;
  private readonly dependencies: McpAgentProfileDependencies;

  /**
   * Creates the API.
   *
   * @param dependencies - The token check, the account lookup and the profile reads.
   */
  public constructor(dependencies: McpAgentProfileDependencies) {
    this.dependencies = dependencies;
    this.profiles = dependencies.profiles.forChannel("mcp");
  }

  /**
   * Checks the token of a request and the account behind it.
   *
   * @param authorization - The `Authorization` header of the request.
   * @returns The account the token acts for.
   * @throws {McpDeviceError} `invalid_token` for a missing, unknown or revoked token.
   * @throws {McpAgentError} `invalid_token` when the account is gone or deactivated.
   */
  public async authenticate(
    authorization: string | null,
  ): Promise<McpAgentProfileActor> {
    const identity =
      await this.dependencies.devices.authenticate(authorization);
    const credentials =
      await this.dependencies.accounts.findCredentialsByUsername(
        identity.account.username,
      );
    // Only the account leaves this lookup; the password hash is not kept.
    const account = credentials?.user ?? null;
    if (account === null || !account.isActive)
      throw new McpAgentError("invalid_token");
    return { userId: account.id };
  }
}

/** The status of each failure of a profile read. */
const STATUS_OF_CODE = {
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  payload_too_large: 413,
} as const;

/**
 * Turns a failure of a profile read into the answer of the interface.
 *
 * @param error - Whatever a service or the parser threw.
 * @returns The status and the body, or `null` for a failure that is not the client's doing.
 */
export function profileFailure(error: unknown): {
  readonly status: number;
  readonly body: Readonly<Record<string, string>>;
} | null {
  if (!(error instanceof AgentProfileError)) return null;
  return {
    status: STATUS_OF_CODE[error.code],
    body:
      error.reason === null
        ? { error: error.code }
        : { error: error.code, reason: error.reason },
  };
}

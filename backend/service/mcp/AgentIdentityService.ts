import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { CAPABILITY } from "@/definition/Authorization";

import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Resolves current rights on the MCP path without changing the browser's active role mode. */
export class AgentIdentityService {
  private readonly users: Pick<UserService, "getById">;
  private readonly administration: Pick<AdministrationService, "getContext">;

  public constructor(
    users: Pick<UserService, "getById">,
    administration: Pick<AdministrationService, "getContext">,
  ) {
    this.users = users;
    this.administration = administration;
  }

  /** Loads fresh user and account facts; inactive and mandatory-password accounts fail closed. */
  public async verify(userId: string): Promise<AgentIdentity> {
    const user = await this.users.getById(userId);
    if (!user || !user.isActive || user.mustChangePassword) {
      throw new McpAuthorizationError("invalid_token", 401);
    }
    const account = await this.administration.getContext(userId);
    if (!account.isActive) {
      throw new McpAuthorizationError("invalid_token", 401);
    }
    return {
      userId,
      isAdmin: account.isAdmin,
      permissions: account.isAdmin
        ? Object.values(CAPABILITY)
        : (account.role?.permissions ?? []),
    };
  }
}

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { PersonalAgentTokenService } from "./mcp/PersonalAgentTokenService";
import type { OAuthTokenService } from "./mcp/OAuthTokenService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Verifies stdio/API delegation credentials and denies all business operations in A9.2. */
export class PagesAgentApiService {
  private readonly personal: PersonalAgentTokenService;
  private readonly oauth: OAuthTokenService;

  public constructor(
    personal: PersonalAgentTokenService,
    oauth: OAuthTokenService,
  ) {
    this.personal = personal;
    this.oauth = oauth;
  }

  /** Resolves current rights; OAuth access tokens are never accepted as API credentials. */
  public async verify(token: string): Promise<AgentIdentity> {
    try {
      return await this.personal.verify(token);
    } catch (error: unknown) {
      if (
        !(error instanceof McpAuthorizationError) ||
        error.code !== "invalid_token"
      )
        throw error;
    }
    try {
      return await this.oauth.verifyDelegation(token);
    } catch (error: unknown) {
      if (error instanceof McpAuthorizationError)
        throw new McpAuthorizationError("invalid_token", 401);
      throw error;
    }
  }

  /** Returns only verified identity/rights and the empty implemented tool catalog. */
  public async handle(
    token: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<{
    readonly apiVersion: "1";
    readonly identity: AgentIdentity;
    readonly tools: readonly [];
  }> {
    const identity = await this.verify(token);
    if (input.operation !== "verify")
      throw new McpAuthorizationError("FORBIDDEN", 403);
    return { apiVersion: "1", identity, tools: [] };
  }
}

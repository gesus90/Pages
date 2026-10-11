import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";
import type { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Revalidates the hashed authority of an issued ticket, including live OAuth consent and account rights. */
export class AgentUploadAuthorityService {
  private readonly personal: PersonalAgentTokenService;
  private readonly oauth: OAuthTokenService;

  public constructor(
    personal: PersonalAgentTokenService,
    oauth: OAuthTokenService,
  ) {
    this.personal = personal;
    this.oauth = oauth;
  }

  /** Accepts only an origin credential that was valid when the ticket was issued. */
  public async verify(hash: string, issuedAt: number): Promise<AgentIdentity> {
    try {
      return await this.personal.verifyHash(hash);
    } catch (error: unknown) {
      if (
        !(error instanceof McpAuthorizationError) ||
        error.code !== "invalid_token"
      )
        throw error;
    }
    try {
      return await this.oauth.verifyDelegationHash(hash, issuedAt);
    } catch (error: unknown) {
      if (error instanceof McpAuthorizationError)
        throw new McpAuthorizationError("invalid_token", 401);
      throw error;
    }
  }
}

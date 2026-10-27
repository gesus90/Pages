import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Revalidates the personal credential and current account rights of an issued ticket. */
export class AgentUploadAuthorityService {
  private readonly personal: PersonalAgentTokenService;
  private readonly runs: AgentRunCredentialService | null;

  public constructor(
    personal: PersonalAgentTokenService,
    runs: AgentRunCredentialService | null = null,
  ) {
    this.personal = personal;
    this.runs = runs;
  }

  /** Requires the ticket's originating personal credential to remain valid. */
  public async verify(hash: string): Promise<AgentIdentity> {
    try {
      return await this.personal.verifyHash(hash);
    } catch (error: unknown) {
      if (!(error instanceof McpAuthorizationError)) throw error;
      const identity = await this.runs?.verifyHash(hash);
      if (!identity) throw error;
      return identity;
    }
  }
}

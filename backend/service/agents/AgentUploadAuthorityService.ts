import type { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Revalidates the personal credential and current account rights of an issued ticket. */
export class AgentUploadAuthorityService {
  private readonly personal: PersonalAgentTokenService;

  public constructor(personal: PersonalAgentTokenService) {
    this.personal = personal;
  }

  /** Requires the ticket's originating personal credential to remain valid. */
  public async verify(hash: string): Promise<AgentIdentity> {
    return this.personal.verifyHash(hash);
  }
}

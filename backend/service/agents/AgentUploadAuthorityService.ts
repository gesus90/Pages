import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Revalidates the step credential and current account rights of an issued ticket. */
export class AgentUploadAuthorityService {
  private readonly runs: AgentRunCredentialService;

  public constructor(runs: AgentRunCredentialService) {
    this.runs = runs;
  }

  /** Requires the ticket's originating step credential to remain valid. */
  public async verify(hash: string): Promise<AgentIdentity> {
    const identity = await this.runs.verifyHash(hash);
    if (!identity) throw new McpAuthorizationError("invalid_token", 401);
    return identity;
  }
}

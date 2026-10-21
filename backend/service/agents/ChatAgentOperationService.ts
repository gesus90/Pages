import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PageAgentOperationService } from "./PageAgentOperationService";

import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { PageAgentOperationDependencies } from "./PageAgentOperationService";

/** Compatibility reads of retained definitions; new configuration belongs to plan nodes. */
export class ChatAgentOperationService {
  private readonly operations: PageAgentOperationService;

  public constructor(dependencies: PageAgentOperationDependencies) {
    this.operations = new PageAgentOperationService(dependencies);
  }

  /** Retired clone/delete requests return a stable reason without deleting saved content. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    if (operation === "agents.clone" || operation === "agents.delete")
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "operation_retired",
      });
    return this.operations.handle(identity, operation, input);
  }
}

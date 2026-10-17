import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ChatError } from "@/backend/error/ChatErrors";
import { readChatDeletionIds } from "@/backend/service/chat/ChatSessionService";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";

interface SessionOperationDependencies {
  readonly sessions: Pick<ChatSessionService, "list" | "removeSelected">;
  readonly users: Pick<UserService, "getById">;
}

function readSessionParameters(
  operation: "chat.sessions.list" | "chat.sessions.delete",
  input: unknown,
): Readonly<Record<string, unknown>> {
  if (
    input !== undefined &&
    (typeof input !== "object" || input === null || Array.isArray(input))
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const parameters = readAgentObject(input);
  const allowed =
    operation === "chat.sessions.list"
      ? []
      : ["sessionIds", "expectedCount", "confirmation"];
  if (Object.keys(parameters).some((key) => !allowed.includes(key)))
    throw new AgentOperationError("INVALID_REQUEST");
  return parameters;
}

/** MCP-only adapter: a UI button or a supplied policy flag never replaces LÖSCHEN. */
export class AgentChatSessionOperationService {
  private readonly dependencies: SessionOperationDependencies;

  public constructor(dependencies: SessionOperationDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists own sessions or deletes an exact counted selection after typed MCP confirmation. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    if (
      operation !== "chat.sessions.list" &&
      operation !== "chat.sessions.delete"
    )
      return null;
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new AgentOperationError("FORBIDDEN");
    const parameters = readSessionParameters(operation, input);
    try {
      if (operation === "chat.sessions.list") {
        const sessions = await this.dependencies.sessions.list(actor);
        return {
          apiVersion: "1",
          result: { sessions, total: sessions.length },
        };
      }
      if (parameters.confirmation !== "LÖSCHEN")
        throw new AgentOperationError("CONFIRMATION_REQUIRED");
      const ids = readChatDeletionIds(parameters.sessionIds);
      if (parameters.expectedCount !== ids.length)
        throw new AgentOperationError("INVALID_REQUEST");
      return {
        apiVersion: "1",
        result: await this.dependencies.sessions.removeSelected(actor, ids),
      };
    } catch (error: unknown) {
      logCaughtError("AgentChatSessionOperationService", error);

      if (!(error instanceof ChatError)) throw error;
      const code =
        error.code === "sessionMissing" ? "NOT_FOUND" : "INVALID_REQUEST";
      throw new AgentOperationError(code);
    }
  }
}

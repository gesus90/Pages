import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ChatError } from "@/backend/error/ChatErrors";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import {
  isChatConfirmationOperation,
  requiresChatConfirmation,
  isChatOperation,
  isChatWriteOperation,
} from "./ChatToolCatalog";

import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { ChatConfirmationWord } from "@/definition/Chat";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { ChatActionOutcome } from "./ChatPrompt";

/** Keys only Pages sets; the agent can neither replay an operation nor confirm a deletion. */
const SERVER_KEYS: ReadonlySet<string> = new Set([
  "operationId",
  "confirmation",
]);

/** One action the agent requested. */
export interface ChatActionRequest {
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** What the actions of the chat agent run through. */
export interface ChatToolDependencies {
  /** The operation catalog of the agent API, wired for the chat channel. */
  readonly router: Pick<AgentOperationRouter, "handle">;
  readonly identities: Pick<AgentIdentityService, "verify">;
}

/**
 * Runs the actions of the chat agent with the current rights of the person
 * (T6.12.5, T6.12.7).
 *
 * @remarks
 * Every action goes through the same services and checks as the interface
 * and MCP; there is no other write path. Rights are resolved anew for every
 * action. Operations outside the catalog, such as files, the database or
 * server files, do not exist for the agent. A deletion runs only when the
 * person typed the confirmation word in the current message.
 */
export class ChatToolExecutor {
  private readonly dependencies: ChatToolDependencies;

  public constructor(dependencies: ChatToolDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one action for the person.
   *
   * @param userId - The person the chat speaks with.
   * @param action - The operation and parameters the agent requested.
   * @param confirmation - The confirmation word the person typed in the current message, or `null`.
   * @returns The result, or a stable error code the agent can explain.
   * @throws {ChatError} `accessDenied` when the account may no longer act.
   */
  public async run(
    userId: string,
    action: ChatActionRequest,
    confirmation: ChatConfirmationWord | null,
  ): Promise<ChatActionOutcome> {
    const { operation } = action;
    if (!isChatOperation(operation))
      return { ok: false, error: "UNKNOWN_OPERATION" };
    const isConfirmed = isChatConfirmationOperation(operation);
    if (requiresChatConfirmation(operation) && confirmation === null)
      return { ok: false, error: "CONFIRMATION_REQUIRED" };
    const parameters = {
      ...Object.fromEntries(
        Object.entries(action.parameters).filter(
          ([key]) => !SERVER_KEYS.has(key),
        ),
      ),
      ...(isChatWriteOperation(operation) ? { operationId: randomUUID() } : {}),
      ...(isConfirmed && confirmation !== null ? { confirmation } : {}),
    };
    const identity = await this.verify(userId);
    try {
      const response = await this.dependencies.router.handle(identity, {
        operation,
        parameters,
      });
      return {
        ok: true,
        result: response.result,
        ...("temporaryPassword" in response && response.temporaryPassword
          ? { temporaryPassword: response.temporaryPassword }
          : {}),
      };
    } catch (error: unknown) {
      return failure(operation, error);
    }
  }

  private async verify(userId: string): Promise<AgentIdentity> {
    try {
      return await this.dependencies.identities.verify(userId);
    } catch (error: unknown) {
      if (error instanceof McpAuthorizationError)
        throw new ChatError("accessDenied");
      throw error;
    }
  }
}

function failure(operation: string, error: unknown): ChatActionOutcome {
  if (error instanceof AgentOperationError)
    return error.details === undefined
      ? { ok: false, error: error.code }
      : { ok: false, error: error.code, details: error.details };
  if (error instanceof McpAuthorizationError)
    return { ok: false, error: "FORBIDDEN" };
  // Only the operation and the kind of error are logged, never parameters or content.
  console.error(
    "[pages] A chat action failed.",
    operation,
    error instanceof Error ? error.name : typeof error,
  );
  return { ok: false, error: "FAILED" };
}

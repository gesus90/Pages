import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AutomationError } from "@/backend/error/AutomationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  isAutomationOperation,
  isAutomationReadOperation,
} from "@/definition/AutomationOperations";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  AgentOperationDetails,
  PagesAgentReadResponse,
} from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type {
  AutomationReadOperation,
  AutomationReadResult,
  AutomationWriteOperation,
  AutomationWriteResult,
} from "@/definition/AutomationOperations";
import type { AutomationService } from "./AutomationService";

/** What the adapter of the agent tools and the chat is built from. */
export interface AutomationOperationDependencies {
  readonly automations: AutomationService;
  /** The chat confirms a deletion with the person's typed word, besides `confirmed`. */
  readonly channel?: AgentChannel;
}

const CODES: Readonly<
  Record<AutomationError["code"], AgentOperationError["code"]>
> = {
  invalid_request: "INVALID_REQUEST",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  too_large: "PAYLOAD_TOO_LARGE",
  rate_limited: "INVALID_REQUEST",
  server_unavailable: "INVALID_REQUEST",
};

function detailsOf(error: AutomationError): AgentOperationDetails | undefined {
  if (error.code === "conflict" && error.currentRevision !== null)
    return { currentRevision: error.currentRevision };
  if (error.reason === "validation")
    return { reason: "validation", problems: error.problems };
  if (error.reason === null) return undefined;
  if (error.reason === "workspace_unavailable")
    return { reason: "workspace_unavailable" };
  return { reason: error.reason };
}

/**
 * Translates a refusal of the automation service into the fixed errors of
 * the agent API.
 *
 * @param error - The caught error.
 */
export function translateAutomationError(error: unknown): unknown {
  if (!(error instanceof AutomationError)) return error;
  return new AgentOperationError(CODES[error.code], detailsOf(error));
}

/**
 * The operations of automations for the agent tools, the internal bridges
 * of user agents and Pica (PAGE-297).
 *
 * @remarks
 * The adapter holds no rule of its own: every call runs through the
 * automation service with the rules of the page, as the verified account of
 * the call. An agent account creates and manages its own automations as
 * itself; reach, read-only access and confirmations stay those of its
 * channel.
 */
export class AutomationOperationService {
  private readonly dependencies: AutomationOperationDependencies;

  public constructor(dependencies: AutomationOperationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Handles an operation of automations; `null` for every other name.
   *
   * @param identity - The verified identity of the call.
   * @param operation - The operation name as received.
   * @param input - The raw parameters.
   * @throws {AgentOperationError} The translated refusal.
   */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    if (!isAutomationOperation(operation)) return null;
    try {
      const response = isAutomationReadOperation(operation)
        ? {
            apiVersion: "1" as const,
            result: await this.read(identity.userId, operation, input),
          }
        : {
            apiVersion: "1" as const,
            result: await this.write(identity.userId, operation, input),
          };
      if (
        Buffer.byteLength(JSON.stringify(response)) >
        PAGES_AGENT_LIMITS.responseBytes
      )
        throw new AgentOperationError("PAYLOAD_TOO_LARGE");
      return response;
    } catch (error: unknown) {
      logCaughtError("AutomationOperationService", error);
      throw translateAutomationError(error);
    }
  }

  private async read(
    userId: string,
    operation: AutomationReadOperation,
    input: unknown,
  ): Promise<AutomationReadResult> {
    const { automations } = this.dependencies;
    switch (operation) {
      case "automations.options.read":
        return automations.options(userId);
      case "automations.list":
        return automations.list(userId, input);
      case "automations.read":
        return automations.read(userId, input);
      case "automations.runs.list":
        return automations.runs(userId, input);
      case "automations.runs.read":
        return automations.run(userId, input);
    }
  }

  private async write(
    userId: string,
    operation: AutomationWriteOperation,
    input: unknown,
  ): Promise<AutomationWriteResult> {
    const { automations } = this.dependencies;
    switch (operation) {
      case "automations.create":
        return automations.create(userId, input);
      case "automations.update":
        return automations.update(userId, input);
      case "automations.setActive":
        return automations.setActive(userId, input);
      case "automations.run":
        return automations.runNow(userId, input);
      case "automations.delete":
        return automations.delete(userId, this.deletionInput(input), {
          requiresWord: this.dependencies.channel === "chat",
        });
    }
  }

  /** The chat names its typed confirmation; it counts as the explicit confirmation. */
  private deletionInput(input: unknown): unknown {
    if (
      this.dependencies.channel !== "chat" ||
      typeof input !== "object" ||
      input === null ||
      !("confirmation" in input)
    )
      return input;
    return { ...input, confirmed: true };
  }
}

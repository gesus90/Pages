import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ChatError } from "@/backend/error/ChatErrors";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import {
  isChatConfirmationOperation,
  requiresChatConfirmation,
  isChatOperation,
  isChatWriteOperation,
} from "./ChatToolCatalog";
import {
  PicaPlanConfirmation,
  picaPlanOperationId,
} from "./PicaPlanConfirmation";

import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { ChatConfirmationWord } from "@/definition/Chat";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { ChatActionOutcome } from "./ChatPrompt";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaPlanTurn } from "./PicaPlanConfirmation";

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
  private readonly planConfirmation = new PicaPlanConfirmation();

  public constructor(dependencies: ChatToolDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one action for the person.
   *
   * @param userId - The person the chat speaks with.
   * @param action - The operation and parameters the agent requested.
   * @param confirmation - The confirmation word the person typed in the current message, or `null`.
   * @param agentConfirmation - The ticket-required German word for agent deletion, taken only from the current message.
   * @returns The result, or a stable error code the agent can explain.
   * @throws {ChatError} `accessDenied` when the account may no longer act.
   */
  public async run(
    userId: string,
    action: ChatActionRequest,
    confirmation: ChatConfirmationWord | null,
    agentConfirmation: "LÖSCHEN" | null = confirmation === "LÖSCHEN"
      ? confirmation
      : null,
  ): Promise<ChatActionOutcome> {
    const { operation } = action;
    if (!isChatOperation(operation))
      return { ok: false, error: "UNKNOWN_OPERATION" };
    // The legacy action envelope has no server-owned conversation target binding.
    if (operation === "plans.delete")
      return { ok: false, error: "CONFIRMATION_REQUIRED" };
    logEvent({
      level: "debug",
      event: "chat.tool.started",
      component: "ChatToolExecutor",
      message: "Chat tool operation started",
      metadata: { operation, userId },
    });
    const isConfirmed = isChatConfirmationOperation(operation);
    const typedConfirmation =
      operation === "agents.delete" ? agentConfirmation : confirmation;
    if (requiresChatConfirmation(operation) && typedConfirmation === null)
      return { ok: false, error: "CONFIRMATION_REQUIRED" };
    const parameters = {
      ...Object.fromEntries(
        Object.entries(action.parameters).filter(
          ([key]) => !SERVER_KEYS.has(key),
        ),
      ),
      ...(isChatWriteOperation(operation) ? { operationId: randomUUID() } : {}),
      ...(isConfirmed && typedConfirmation !== null
        ? { confirmation: typedConfirmation }
        : {}),
    };
    return this.dispatch(userId, operation, parameters);
  }

  /** Native plan calls use server-owned identity, stable turn keys and target-bound human deletion consent. */
  public async runPlan(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
    turn: PicaPlanTurn,
  ): Promise<ChatActionOutcome> {
    await context.authorize();
    if (
      !isChatOperation(action.operation) ||
      !action.operation.startsWith("plans.")
    )
      return { ok: false, error: "UNKNOWN_OPERATION" };
    const parameters = Object.fromEntries(
      Object.entries(action.parameters).filter(
        ([key]) => !SERVER_KEYS.has(key),
      ),
    );
    const request = { operation: action.operation, parameters };
    if (
      action.operation === "plans.delete" &&
      !this.planConfirmation.hasApproval(request, context, turn)
    ) {
      const prompt = await this.deletionPrompt(
        context.userId,
        parameters,
        turn,
      );
      if (prompt.error !== "CONFIRMATION_REQUIRED") return prompt;
      if (!this.planConfirmation.consume(request, context, turn)) return prompt;
    }
    return this.dispatch(context.userId, action.operation, {
      ...parameters,
      ...(isChatWriteOperation(action.operation)
        ? { operationId: picaPlanOperationId(request, context, turn.id) }
        : {}),
      ...(action.operation === "plans.delete"
        ? { confirmation: turn.confirmation }
        : {}),
    });
  }

  private async deletionPrompt(
    userId: string,
    parameters: Readonly<Record<string, unknown>>,
    turn: PicaPlanTurn,
  ): Promise<ChatActionOutcome> {
    const response = await this.dispatch(userId, "plans.control.read", {
      planId: parameters.planId,
    });
    if (!response.ok) return response;
    const result = response.result;
    if (typeof result !== "object" || result === null || !("control" in result))
      return { ok: false, error: "FAILED" };
    const plan = result.control;
    if (
      typeof plan !== "object" ||
      plan === null ||
      !("canDelete" in plan) ||
      !("revision" in plan)
    )
      return { ok: false, error: "FAILED" };
    if (plan.canDelete !== true) return { ok: false, error: "FORBIDDEN" };
    if (plan.revision !== parameters.expectedRevision)
      return { ok: false, error: "CONFLICT" };
    return {
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      result: {
        planId: parameters.planId,
        ownerId: userId,
        expectedRevision: plan.revision,
        confirmation: turn.confirmation,
        scope:
          "Only this saved plan is removed; finished history stays stored, workspace files and templates stay untouched. Ask the person to reply with the existing confirmation word in a new message.",
      },
    };
  }

  private async dispatch(
    userId: string,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<ChatActionOutcome> {
    const identity = await this.verify(userId);
    try {
      const response = await this.dependencies.router.handle(identity, {
        operation,
        parameters,
      });
      logEvent({
        level: "info",
        event: "chat.tool.completed",
        component: "ChatToolExecutor",
        message: "Chat tool operation completed",
        metadata: { operation, userId },
      });
      return {
        ok: true,
        result: response.result,
        ...("temporaryPassword" in response && response.temporaryPassword
          ? { temporaryPassword: response.temporaryPassword }
          : {}),
      };
    } catch (error: unknown) {
      logCaughtError("ChatToolExecutor", error);

      return failure(operation, error);
    }
  }

  private async verify(userId: string): Promise<AgentIdentity> {
    try {
      return await this.dependencies.identities.verify(userId);
    } catch (error: unknown) {
      logCaughtError("ChatToolExecutor", error);

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
  logDiagnostic(
    "ChatToolExecutor",
    "error",
    "[pages] A chat action failed.",
    error,
  );
  return { ok: false, error: "FAILED" };
}

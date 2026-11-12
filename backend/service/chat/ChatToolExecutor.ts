import { randomUUID } from "node:crypto";

import { AgentAuthorizationError } from "@/backend/error/AgentAuthorizationError";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ChatError } from "@/backend/error/ChatErrors";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import {
  isChatConfirmationOperation,
  isChatDeleteOperation,
  requiresChatConfirmation,
  isChatOperation,
  isChatWriteOperation,
} from "./ChatToolCatalog";
import {
  PicaPlanConfirmation,
  picaPlanOperationId,
} from "./PicaPlanConfirmation";
import {
  PICA_UNOFFERED_OPERATIONS,
  isPicaCriticalOperation,
} from "./admin/PicaOperatorCatalog";

import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { ChatConfirmationWord } from "@/definition/Chat";
import type { ChatActionOutcome } from "./ChatPrompt";
import type { ChatOperation } from "./ChatToolCatalog";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaIdentity, PicaIdentityService } from "./PicaIdentityService";
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

/** An administrator call after Pages checked that its operation exists for the chat. */
interface AdminCall {
  readonly operation: ChatOperation;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** What the actions of the chat agent run through. */
export interface ChatToolDependencies {
  /** The operation catalog of the agent API, wired for the chat channel. */
  readonly router: Pick<AgentOperationRouter, "handle">;
  readonly identities: Pick<PicaIdentityService, "verify">;
}

/**
 * Runs the actions of the chat agent with the current rights of the person
 * (T6.12.5, T6.12.7).
 *
 * @remarks
 * Every action goes through the same services and checks as the interface.
 * Rights are resolved anew for every action. Operations outside the catalog, such as files, the database or
 * server files, do not exist for the agent. A deletion runs only when the
 * person explicitly requested it in the current message.
 */
export class ChatToolExecutor {
  private readonly dependencies: ChatToolDependencies;
  private readonly adminConfirmation = new PicaPlanConfirmation();

  public constructor(dependencies: ChatToolDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one action for the person.
   *
   * @param userId - The person the chat speaks with.
   * @param action - The operation and parameters the agent requested.
   * @param confirmation - The legacy administrative confirmation, or `null`.
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
    logEvent({
      level: "debug",
      event: "chat.tool.started",
      component: "ChatToolExecutor",
      message: "Chat tool operation started",
      metadata: { operation, userId },
    });
    const isConfirmed = isChatConfirmationOperation(operation);
    const typedConfirmation = confirmation;
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

  /** Native plan calls use server-owned identity and stable turn keys. */
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
    return this.dispatch(context.userId, action.operation, {
      ...parameters,
      ...(isChatWriteOperation(action.operation)
        ? { operationId: picaPlanOperationId(request, context, turn.id) }
        : {}),
    });
  }

  /**
   * Runs one administrator operation with server-owned identity and stable keys.
   *
   * @param action - The operation and the parameters the model requested.
   * @param context - The server-owned scope; the caller has resolved the administrator right.
   * @param turn - The raw human message of this turn and the server-owned legacy confirmation.
   * @returns The result, or `CONFIRMATION_REQUIRED` with the exact call to approve.
   *
   * @remarks
   * A critical change, and any change a service holds back for a
   * confirmation, runs only after the person explicitly approved it in a
   * later message than the one that asked. Pages binds that
   * reply to the exact operation and parameters; the model can neither
   * supply nor reuse it. Operations whose result carries a one-time password
   * do not exist here.
   */
  public async runAdmin(
    action: ChatActionRequest,
    context: RuntimeExecutionContext,
    turn: PicaPlanTurn,
  ): Promise<ChatActionOutcome> {
    await context.authorize();
    const { operation } = action;
    if (
      !isChatOperation(operation) ||
      operation.startsWith("plans.") ||
      Object.hasOwn(PICA_UNOFFERED_OPERATIONS, operation)
    )
      return { ok: false, error: "UNKNOWN_OPERATION" };
    const request: AdminCall = {
      operation,
      parameters: Object.fromEntries(
        Object.entries(action.parameters).filter(
          ([key]) => !SERVER_KEYS.has(key),
        ),
      ),
    };
    const isCritical =
      isPicaCriticalOperation(operation) && !isChatDeleteOperation(operation);
    if (isCritical && !this.adminConfirmation.consume(request, context, turn))
      return this.consentPrompt(request);
    const outcome = await this.dispatchAdmin(
      request,
      context,
      turn,
      isCritical,
    );
    if (isCritical || outcome.error !== "CONFIRMATION_REQUIRED") return outcome;
    // The service holds the change back until the person confirmed it.
    return this.adminConfirmation.consume(request, context, turn)
      ? this.dispatchAdmin(request, context, turn, true)
      : this.consentPrompt(request);
  }

  private dispatchAdmin(
    request: AdminCall,
    context: RuntimeExecutionContext,
    turn: PicaPlanTurn,
    isConfirmed: boolean,
  ): Promise<ChatActionOutcome> {
    const { operation, parameters } = request;
    return this.dispatch(context.userId, operation, {
      ...parameters,
      ...(isChatWriteOperation(operation)
        ? { operationId: picaPlanOperationId(request, context, turn.id) }
        : {}),
      ...(isConfirmed ? { confirmation: turn.confirmation } : {}),
    });
  }

  private consentPrompt(request: AdminCall): ChatActionOutcome {
    return {
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      result: {
        operation: request.operation,
        parameters: request.parameters,
        scope:
          "Name this exact change and its effect to the person, then ask them to approve it explicitly in a new message. Only that reply allows the change; repeat the identical call afterwards.",
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

  private async verify(userId: string): Promise<PicaIdentity> {
    try {
      return await this.dependencies.identities.verify(userId);
    } catch (error: unknown) {
      logCaughtError("ChatToolExecutor", error);

      if (error instanceof AgentAuthorizationError)
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
  if (error instanceof AgentAuthorizationError)
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

import {
  PROTOCOL_VERSION,
  RequestError,
  methods,
} from "@agentclientprotocol/sdk";

import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { readOpenCodeSessionUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { readContinuationCapabilities } from "@/backend/service/agents/sessions/AgentSessionContinuation";

import { isAcpSteeringSupported } from "./AcpChat";
import { requireAcpMcpCapabilities } from "./AcpLaunch";
import { closeAcpProtocol } from "./AcpProtocolClose";
import { requireVerifiedAcpAdapter } from "./AcpSessionConfiguration";
import {
  abortFailure,
  acpErrorFailure,
  disconnectedAcpOutcome,
  finishAcpTurn,
} from "./AcpSessionOutcome";

import type {
  ClientConnection,
  PromptCapabilities,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type {
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AcpSessionState } from "./AcpEvents";
import type { AcpSessionContext, OpenedSession } from "./AcpSessionContracts";
import type { PicaCodexRequests } from "./PicaCodexRequests";

/** Arguments for {@link initializeAcpSessionConnection}. */
export interface AcpInitializeOptions {
  readonly connection: ClientConnection;
  readonly context: AcpSessionContext;
  readonly state: AcpSessionState;
  readonly observer: PlanSessionObserver;
  readonly isPicaCodex: boolean;
}

/** Negotiated protocol capabilities from `initialize`. */
export interface AcpInitializeResult {
  readonly isSteeringSupported: boolean;
  readonly promptCapabilities: PromptCapabilities | null | undefined;
}

/** Arguments for {@link openOrResumeAcpSession}. */
export interface AcpOpenSessionOptions {
  readonly connection: ClientConnection;
  readonly context: AcpSessionContext;
  readonly state: AcpSessionState;
}

/** Arguments for {@link resolveAcpTurnFailure}. */
export interface AcpTurnFailureOptions {
  readonly error: unknown;
  readonly turnSignal: AbortSignal;
  readonly process: Pick<CliSessionProcess, "exited">;
  readonly connectionAborted: boolean;
  readonly state: AcpSessionState;
  readonly context: AcpSessionContext;
  readonly isPicaNative: boolean;
  readonly notificationFailure: AgentErrorCode | null;
  readonly hasHistoryFailure: boolean;
  readonly redact: (text: string) => string;
}

/** Arguments for {@link shutDownAcpSession}. */
export interface AcpShutDownOptions {
  readonly connection: ClientConnection;
  readonly process: Pick<CliSessionProcess, "endInput" | "exited" | "cancel">;
  readonly context: AcpSessionContext;
  readonly sessionId: string | null;
  readonly picaCodex: PicaCodexRequests | null;
  readonly abortRequests: () => void;
}

/** Reads newly stored OpenCode message usage for the active session when configured. */
export function forwardOpenCodeSessionUsage(
  context: AcpSessionContext,
  sessionId: string,
): void {
  const path = context.openCodeUsagePath;
  const directory = context.openCodePricingDirectory;
  const receive = context.listener?.openCodeMessages;
  if (context.driver.provider !== "opencode" || !path || !directory || !receive)
    return;
  try {
    receive(
      readOpenCodeSessionUsage(path, sessionId),
      directory,
      context.isFreeModel === true ? context.request.model : null,
      context.openRouterModelIds ?? {},
    );
  } catch (error: unknown) {
    logCaughtError("AcpSession.openCodeUsage", error);
  }
}

/** Performs the ACP `initialize` handshake and reports adapter capabilities. */
export async function initializeAcpSessionConnection(
  options: AcpInitializeOptions,
): Promise<AcpInitializeResult> {
  const { connection, context, state, observer, isPicaCodex } = options;
  const response = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  requireAcpMcpCapabilities(
    context.request.mcpServers,
    response.agentCapabilities?.mcpCapabilities,
  );
  const promptCapabilities = response.agentCapabilities?.promptCapabilities;
  const isSteeringSupported =
    !isPicaCodex && isAcpSteeringSupported(response._meta);
  context.listener?.initialized?.(isSteeringSupported, promptCapabilities);
  context.listener?.announced?.(response.agentCapabilities);
  const adapter = requireVerifiedAcpAdapter(state, context.driver, response);
  const continuation =
    context.profile.keepsSession === false
      ? { canResume: false, canLoad: false }
      : readContinuationCapabilities(response.agentCapabilities);
  observer.capabilities?.({ ...continuation, adapter });
  return { isSteeringSupported, promptCapabilities };
}

/** Opens a new ACP protocol session or resumes an earlier one. */
export async function openOrResumeAcpSession(
  options: AcpOpenSessionOptions,
): Promise<{
  readonly sessionId: string;
  readonly options: readonly SessionConfigOption[] | null | undefined;
}> {
  const { connection, context, state } = options;
  const { request } = context;
  const resumeSessionId = request.resumeSessionId ?? null;
  if (resumeSessionId !== null) {
    noteSessionEvent(state.events, "resume session");
    try {
      const response = await connection.agent.request(
        methods.agent.session.resume,
        {
          sessionId: resumeSessionId,
          cwd: request.directory,
          mcpServers: [...request.mcpServers],
          _meta: { ...request.sessionMeta },
        },
      );
      return { sessionId: resumeSessionId, options: response.configOptions };
    } catch (error: unknown) {
      logCaughtError("AcpSession", error);
      // The adapter refused the session; a lost connection fails as it always does.
      if (error instanceof RequestError && !connection.signal.aborted)
        throw new AgentError("acp_session_resume_failed");
      throw error;
    }
  }
  const response = await connection.agent.request(methods.agent.session.new, {
    cwd: request.directory,
    mcpServers: [...request.mcpServers],
    _meta: { ...request.sessionMeta },
  });
  return { sessionId: response.sessionId, options: response.configOptions };
}

/** Maps a failed or aborted ACP turn to its final {@link PlanSessionTurn}. */
export async function resolveAcpTurnFailure(
  options: AcpTurnFailureOptions,
): Promise<PlanSessionTurn> {
  const {
    error,
    turnSignal,
    process,
    connectionAborted,
    state,
    context,
    isPicaNative,
    notificationFailure,
    hasHistoryFailure,
    redact,
  } = options;
  const finish = (
    failure: PlanSessionTurn["failure"],
    errorCode: AgentErrorCode | null,
  ): PlanSessionTurn =>
    finishAcpTurn(
      state,
      {
        failure: notificationFailure ? "failed" : failure,
        errorCode: notificationFailure ?? errorCode,
        hasHistoryFailure,
      },
      redact,
    );
  if (turnSignal.aborted) {
    if (context.driver.provider === "opencode")
      return finish(abortFailure(turnSignal), null);
    // The stop or deadline ends the process; its exit tells which.
    const exit = await process.exited;
    return finish(
      exit.errorCode === "check_timeout" ? "timeout" : "cancelled",
      null,
    );
  }
  const errorCode = acpErrorFailure(error, state, context.driver, {
    isDisconnected: connectionAborted,
    isOpenRouter: context.request.model.startsWith("openrouter/"),
  });
  if (errorCode !== null) return finish("failed", errorCode);
  const outcome = disconnectedAcpOutcome(
    await process.exited,
    state,
    context.driver,
    {
      isPicaNative,
      isOpenRouter: context.request.model.startsWith("openrouter/"),
      redact,
    },
  );
  return finish(outcome.failure, outcome.errorCode);
}

/** Closes the protocol session, worker process, and temporary session assets. */
export async function shutDownAcpSession(
  options: AcpShutDownOptions,
): Promise<PlanSessionClosed> {
  const { connection, process, context, sessionId, picaCodex, abortRequests } =
    options;
  try {
    await picaCodex?.cancelTurn();
    await closeAcpProtocol(connection, sessionId);
    connection.close();
    const closed = await closeCliSession(
      process,
      context.instanceId,
      undefined,
      context.containment ?? "none",
    );
    if (closed.isConfirmed) {
      context.cleanupAdapter?.();
      await context
        .cleanupTemporaryDirectory?.()
        .catch((error: unknown) => logCaughtError("AcpSession", error));
    } else {
      context.releaseTemporaryDirectory?.();
    }
    return closed;
  } finally {
    picaCodex?.close();
    context.signal.removeEventListener("abort", abortRequests);
    await context.secure();
  }
}

export type { OpenedSession };

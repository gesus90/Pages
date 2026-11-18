import {
  PROTOCOL_VERSION,
  RequestError,
  methods,
} from "@agentclientprotocol/sdk";

import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";
import { readContinuationCapabilities } from "@/backend/service/agents/sessions/AgentSessionContinuation";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { requireAcpMcpCapabilities } from "./AcpLaunch";
import { isAcpSteeringSupported } from "./AcpChat";
import { readAcpConfiguration } from "./AcpEvents";
import {
  confirmAcpConfiguration,
  requireVerifiedAcpAdapter,
} from "./AcpSessionConfiguration";

import type {
  ClientConnection,
  PromptCapabilities,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AcpSessionState } from "./AcpEvents";
import type { AcpSessionContext, OpenedSession } from "./AcpSessionContracts";

/** Dependencies required to initialize, open, and configure an ACP protocol session. */
export interface AcpHandshakeTarget {
  readonly connection: ClientConnection;
  readonly context: AcpSessionContext;
  readonly state: AcpSessionState;
  readonly observer: PlanSessionObserver;
  readonly hasPicaCodex: boolean;
  readonly onConfirmThread?: (sessionId: string) => void;
  readonly redact: (text: string) => string;
}

/** Result of the ACP `initialize` handshake. */
export interface InitializedAcpSession {
  readonly promptCapabilities: PromptCapabilities | null | undefined;
  readonly isSteeringSupported: boolean;
}

/** Result of confirming stored ACP configuration options on a session. */
export interface ConfiguredAcpSession {
  readonly options: readonly SessionConfigOption[];
  readonly expected: Readonly<Record<string, string>>;
}

/** Negotiates ACP protocol capabilities and verifies the adapter identity. */
export async function initializeAcpSession(
  target: AcpHandshakeTarget,
): Promise<InitializedAcpSession> {
  const { connection, context, state, observer } = target;
  const response = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  requireAcpMcpCapabilities(
    context.request.mcpServers,
    response.agentCapabilities?.mcpCapabilities ??
      context.driver.mcpCapabilities,
  );
  const promptCapabilities = response.agentCapabilities?.promptCapabilities;
  const isSteeringSupported =
    !target.hasPicaCodex && isAcpSteeringSupported(response._meta);
  context.listener?.initialized?.(isSteeringSupported, promptCapabilities);
  context.listener?.announced?.(response.agentCapabilities);
  const adapter = requireVerifiedAcpAdapter(state, context.driver, response);
  const continuation =
    context.profile.keepsSession === false
      ? { canResume: false, canLoad: false }
      : readContinuationCapabilities(response.agentCapabilities);
  observer.capabilities?.({ ...continuation, adapter });
  return { promptCapabilities, isSteeringSupported };
}

function recordOpenedSession(
  target: AcpHandshakeTarget,
  sessionId: string,
  options: readonly SessionConfigOption[] | null | undefined,
): OpenedSession {
  target.onConfirmThread?.(sessionId);
  target.state.sessionId = sessionId;
  logEvent({
    level: "info",
    event: "acp.session.opened",
    component: "AcpSession",
    message: "ACP session opened",
    metadata: { sessionId, provider: target.context.driver.provider },
  });
  noteSessionEvent(target.state.events, `session ${sessionId}`);
  target.observer.identified(target.redact(sessionId));
  return { sessionId, options: options ?? [] };
}

async function resumeAcpSession(
  target: AcpHandshakeTarget,
  sessionId: string,
): Promise<OpenedSession> {
  const { request } = target.context;
  noteSessionEvent(target.state.events, "resume session");
  try {
    const response = await target.connection.agent.request(
      methods.agent.session.resume,
      {
        sessionId,
        cwd: request.directory,
        mcpServers: [...request.mcpServers],
        _meta: { ...request.sessionMeta },
      },
    );
    return recordOpenedSession(target, sessionId, response.configOptions);
  } catch (error: unknown) {
    logCaughtError("AcpSession", error);

    // The adapter refused the session; a lost connection fails as it always does.
    if (error instanceof RequestError && !target.connection.signal.aborted) {
      if (request.canReplaceMissingSession) return newAcpSession(target);
      throw new AgentError("acp_session_resume_failed");
    }
    throw error;
  }
}

/** Opens a new protocol session or resumes an earlier one for the same directory. */
export async function openAcpSession(
  target: AcpHandshakeTarget,
): Promise<OpenedSession> {
  const { request } = target.context;
  const resumeSessionId = request.resumeSessionId ?? null;
  if (resumeSessionId !== null)
    return resumeAcpSession(target, resumeSessionId);
  return newAcpSession(target);
}

async function newAcpSession(
  target: AcpHandshakeTarget,
): Promise<OpenedSession> {
  const { request } = target.context;
  const response = await target.connection.agent.request(
    methods.agent.session.new,
    {
      cwd: request.directory,
      mcpServers: [...request.mcpServers],
      _meta: { ...request.sessionMeta },
    },
  );
  return recordOpenedSession(
    target,
    response.sessionId,
    response.configOptions,
  );
}

/** Applies and confirms the stored mode, model and effort on the opened session. */
export async function configureAcpSession(
  target: Pick<AcpHandshakeTarget, "connection" | "context" | "state">,
  sessionId: string,
  initial: readonly SessionConfigOption[],
): Promise<ConfiguredAcpSession> {
  const { profile, request, driver } = target.context;
  const options = await confirmAcpConfiguration(
    {
      connection: target.connection,
      state: target.state,
      errors: driver.errors,
      sessionId,
    },
    initial,
    profile.steps(request),
  );
  readAcpConfiguration(target.state, options, profile.reportedOptions);
  if (driver.provider === "opencode")
    target.state.effective.reasoningEffort ??= "default";
  return { options, expected: { ...target.state.effective } };
}

import { constants } from "node:fs";
import { access } from "node:fs/promises";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logEvent } from "@/backend/logging/Logger";
import {
  isAgentWriteAccess,
  nativeAcpProvider,
} from "@/definition/AgentConfiguration";

import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import { providerToolIds } from "./AgentToolRegistry";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation } from "./AgentToolContracts";
import type { AgentToolManagerService } from "./AgentToolManagerService";

/** Verifies local prerequisites before the existing native execution can spawn. */
export async function prepareAgentToolSession(input: {
  readonly manager: AgentToolManagerService;
  readonly request: AgentPlanSessionInput;
  readonly signal: AbortSignal;
}): Promise<ReadonlyMap<AgentToolId, AgentToolLocation>> {
  const { manager, request, signal } = input;
  const provider = nativeAcpProvider(request.agent.connection.provider);
  if (provider === null)
    throw new AgentToolReadinessError("node", "unsupported", "not_installed");
  if (signal.aborted) throw new AgentPlanCancelledError();
  if (
    request.options.browser === true &&
    !request.chat &&
    !isAgentWriteAccess(request.options.access)
  )
    throw new AgentToolReadinessError(
      "playwright_mcp",
      "unsupported",
      "browser_permission_required",
    );
  await request.beforeStart?.();
  try {
    await access(
      request.directory,
      constants.R_OK |
        constants.X_OK |
        (request.options.access === "read_only" ? 0 : constants.W_OK),
    );
  } catch {
    throw new AgentToolReadinessError(
      "workspace",
      "missing_dependency",
      "workspace_unavailable",
    );
  }
  const ready = await waitForAgentTools({ manager, request, signal });
  if (signal.aborted) {
    manager.supervisor.release(request.instanceId);
    throw new AgentPlanCancelledError();
  }
  return ready;
}

/** Keeps the supervisor's process/session metadata aligned with the existing observer. */
export function observeAgentToolSession(
  manager: AgentToolManagerService,
  instanceId: string,
  observer: PlanSessionObserver,
): PlanSessionObserver {
  return {
    ...observer,
    started: (details) => {
      manager.supervisor.identify(instanceId, { processId: details.processId });
      observer.started(details);
    },
    identified: (sessionId) => {
      manager.supervisor.identify(instanceId, { sessionId });
      observer.identified(sessionId);
    },
  };
}

/** Pins the tool generation until the existing native closeout confirms absence of children. */
export function superviseAgentToolSession(
  manager: AgentToolManagerService,
  instanceId: string,
  session: PlanSession,
): PlanSession {
  return {
    turn: session.turn,
    terminated: session.terminated,
    ...(session.next ? { next: session.next.bind(session) } : {}),
    ...(session.steer ? { steer: session.steer.bind(session) } : {}),
    ...(session.interrupt
      ? { interrupt: session.interrupt.bind(session) }
      : {}),
    ...(session.suspend ? { suspend: session.suspend.bind(session) } : {}),
    ...(session.resume ? { resume: session.resume.bind(session) } : {}),
    ...(session.cancelTool
      ? { cancelTool: session.cancelTool.bind(session) }
      : {}),
    close: async () => {
      const closed = await session.close();
      if (closed.isConfirmed) manager.supervisor.release(instanceId);
      return closed;
    },
  };
}

/** Adds one secret-free concrete dependency refusal to a persisted run journal. */
export function agentToolFailureEvents(
  error: unknown,
  events: readonly string[],
): readonly string[] {
  return error instanceof AgentToolReadinessError
    ? [...events, `tool ${error.tool}: ${error.status}; ${error.diagnostic}`]
    : events;
}

async function waitForAgentTools(input: {
  readonly manager: AgentToolManagerService;
  readonly request: AgentPlanSessionInput;
  readonly signal: AbortSignal;
}): Promise<ReadonlyMap<AgentToolId, AgentToolLocation>> {
  const { manager, request, signal } = input;
  const provider = nativeAcpProvider(request.agent.connection.provider);
  if (provider === null)
    throw new AgentToolReadinessError("node", "unsupported", "not_installed");
  let stop: () => void = () => undefined;
  const stopped = new Promise<null>((resolve) => {
    stop = () => resolve(null);
    signal.addEventListener("abort", stop, { once: true });
  });
  const startedAt = performance.now();
  const ready = manager
    .ensureReady({
      provider,
      browser: request.options.browser === true && !request.chat,
      instanceId: request.instanceId,
      isNative: isAgentWriteAccess(request.options.access),
    })
    .then(
      (locations) => {
        if (signal.aborted) manager.supervisor.release(request.instanceId);
        return locations;
      },
      (error: unknown) => {
        logReadinessFailure(error, {
          provider,
          durationMs: Math.round(performance.now() - startedAt),
        });
        throw error;
      },
    );
  try {
    if (signal.aborted) stop();
    const result = await Promise.race([ready, stopped]);
    if (result === null) throw new AgentPlanCancelledError();
    return result;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Names the tool, its status, its diagnostic and how long the readiness wait
 * took when a start is refused; the refusal alone only says
 * `agent_tool_not_ready`.
 */
function logReadinessFailure(
  error: unknown,
  facts: { readonly provider: CliProviderId; readonly durationMs: number },
): void {
  if (!(error instanceof AgentToolReadinessError)) return;
  logEvent({
    level: "warn",
    event: "agent.tool.readiness_failed",
    component: "AgentToolSession",
    message: "An agent start was refused because a tool is not ready",
    metadata: {
      tool: error.tool,
      status: error.status,
      diagnostic: error.diagnostic,
      durationMs: facts.durationMs,
      provider: facts.provider,
    },
  });
}

/** Confirms the same approved adapter version again during the actual native handshake. */
export function pinnedAgentToolDriver(
  driver: AcpDriver,
  version: string | null | undefined,
): AcpDriver {
  if (version === null || version === undefined) return driver;
  return {
    ...driver,
    supportedVersions: version,
    isSupportedAdapter: (agent): agent is NonNullable<typeof agent> =>
      driver.isSupportedAdapter(agent) && agent.version === version,
  };
}

/** Reads the adapter generation's verified version for the provider selected by the connection. */
export function agentToolAdapterVersion(
  provider: CliProviderId,
  locations: ReadonlyMap<AgentToolId, AgentToolLocation> | undefined,
): string | null {
  const id = providerToolIds(provider).at(-1);
  return id ? (locations?.get(id)?.version ?? null) : null;
}

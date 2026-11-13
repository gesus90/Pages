import { bridgeServers } from "./PicaAcpCredential";

import type { McpServer } from "@agentclientprotocol/sdk";
import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { PicaAcpCredential } from "./PicaAcpCredential";
import type {
  PicaAcpPoolSession,
  PicaAcpSessionPool,
} from "./PicaAcpSessionPool";

/** The chat session a job of an agent employee answers through (PAGE-335). */
export interface PicaAcpJobPool {
  readonly sessions: Pick<PicaAcpSessionPool, "open">;
  readonly session: PicaAcpPoolSession;
}

/** What a new native session of the pool starts with instead of the job's own. */
export interface PicaAcpPooledInput {
  readonly listener: AcpSessionListener;
  /** The bridge server with the credential of the session; `null` for a runner without the bridge. */
  readonly servers: readonly McpServer[] | null;
}

/** What a job opens its session with. */
export interface PicaAcpPoolRequest {
  /** The kept chat session of an agent employee; absent opens a session of the job alone. */
  readonly pool: PicaAcpJobPool | undefined;
  readonly plans: Pick<PlanExecution, "open">;
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
  readonly listener: AcpSessionListener;
  readonly credential: Pick<
    PicaAcpCredential,
    "openMcpChannel" | "attachMcpChannel"
  >;
  /** Whether the runner reaches the Pages tools over the bridge as an MCP server. */
  readonly hasBridgeMcp: boolean;
  /** The input of a new native session; a pooled one gets the listener and bridge server of the pool. */
  readonly input: (pooled?: PicaAcpPooledInput) => AgentPlanSessionInput;
  /** The input of the round as the next turn of a resting session. */
  readonly turn: () => AgentPlanExecutionInput;
}

/**
 * Opens the session of a job: the resting session of its chat, a new one
 * kept for the chat, or one of the job alone.
 *
 * @returns The session with the turn of the round running.
 */
export function openPicaSession(
  request: PicaAcpPoolRequest,
): Promise<PlanSession> {
  const { credential, plans, observer, pool } = request;
  if (!pool) return plans.open(request.input(), request.signal, observer);
  return pool.sessions.open({
    session: pool.session,
    signal: request.signal,
    observer,
    listener: request.listener,
    ...(request.hasBridgeMcp
      ? {
          bridge: {
            open: () => credential.openMcpChannel(),
            attach: (channel) => credential.attachMcpChannel(channel),
          },
        }
      : {}),
    start: async (start) => {
      const input = request.input({
        listener: start.listener,
        servers: start.channel ? bridgeServers(start.channel.descriptor) : null,
      });
      return {
        session: await plans.open(input, start.signal, observer),
        instanceId: input.instanceId,
      };
    },
    turn: request.turn,
  });
}

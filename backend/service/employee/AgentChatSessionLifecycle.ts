import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT } from "@/definition/AgentChatSession";

import type { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentChatSession } from "@/backend/database/repositories/employee/AgentChatSessionRepository";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";
import type { User } from "@/definition/User";
import type { AgentMemoryModel } from "./AgentMemoryModel";

const COMPONENT = "AgentChatSessionLifecycle";

/** What the lifecycle of chat sessions runs on. */
export interface AgentChatSessionLifecycleDependencies {
  readonly store: EmployeeStore;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  /** Pica's ACP path; `null` where the server runs no ACP chat. */
  readonly acp: Pick<PicaAcpService, "update" | "stop" | "settled"> | null;
  /** The live processes of the chat sessions; `null` without the ACP path. */
  readonly pool: Pick<PicaAcpSessionPool, "close"> | null;
  readonly acpSessions: Pick<ChatAcpSessionRepository, "remove">;
  /**
   * The model call that writes the summary of a chat. A function, because the
   * model runs in sessions that are wired after the lifecycle.
   */
  readonly summaries: () => Pick<AgentMemoryModel, "summarize">;
  readonly now?: () => Date;
}

/** Whether the context fill reaches a threshold, in percent. */
function isReached(session: StoredAgentChatSession, percent: number): boolean {
  const used = session.contextUsed;
  const size = session.contextSize;
  if (used === null || size === null || size <= 0) return false;
  return (used / size) * 100 >= percent;
}

/**
 * The context fill of a session in percent, rounded; `null` before a round
 * reported it.
 *
 * @param session - The stored session.
 */
export function contextPercentOf(
  session: Pick<StoredAgentChatSession, "contextUsed" | "contextSize">,
): number | null {
  const { contextUsed, contextSize } = session;
  if (contextUsed === null || contextSize === null || contextSize <= 0)
    return null;
  return Math.min(100, Math.round((contextUsed / contextSize) * 100));
}

/**
 * The life of a chat session of an agent after its rounds (PAGE-376): what a
 * round used, the summary the agent writes down, and the restart with it.
 *
 * @remarks
 * A session whose context reaches the threshold of its agent first has its
 * state written down as a summary of the chat, then its process ends and its
 * agent session is forgotten, so the next round starts anew with `MEMORY.md`,
 * `DREAM.md`, that summary and the last messages of the chat. A failed
 * summary does not hold the restart back: the chat stays usable and starts
 * with the summary it had. A restart runs once per session at a time and
 * never while a round of that session runs.
 */
export class AgentChatSessionLifecycle {
  private readonly dependencies: AgentChatSessionLifecycleDependencies;
  private readonly restarts = new Map<string, Promise<void>>();

  public constructor(dependencies: AgentChatSessionLifecycleDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Records what the last round of a session used and, when its context
   * reached the threshold of the agent, restarts the session.
   *
   * @param agent - The account of the agent.
   * @param sessionId - The chat session; a session that is none is left alone.
   */
  public async afterRound(agent: User, sessionId: string): Promise<void> {
    try {
      if (await this.recordRound(agent, sessionId))
        await this.restart(agent, sessionId);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }

  /**
   * Restarts a session that reached its threshold before it answers again.
   * Waits for a restart that is running now.
   *
   * @param agent - The account of the agent.
   * @param sessionId - The chat session about to start a round.
   */
  public async restartIfNeeded(agent: User, sessionId: string): Promise<void> {
    await this.restarts.get(sessionId);
    const session = await this.dependencies.store
      .chatSessions()
      .find(sessionId);
    if (session?.needsRestart !== true) return;
    try {
      await this.restart(agent, sessionId);
    } catch (error: unknown) {
      // The chat has to stay usable: the round starts with a new process anyway.
      logCaughtError(COMPONENT, error);
      await this.forget(agent, sessionId);
    }
  }

  /**
   * Writes the state of the chat down: asks the agent for the summary of the
   * chat and stores it.
   *
   * @param agent - The account of the agent.
   * @param sessionId - The chat session.
   * @returns Whether a summary was stored; `false` for a chat without new
   * messages or an answer the model did not give.
   */
  public async summarize(agent: User, sessionId: string): Promise<boolean> {
    const { store, messages, summaries } = this.dependencies;
    const employee = await store.employees().find(agent.id);
    if (!employee) return false;
    const [transcript, stored] = await Promise.all([
      messages.messages(sessionId),
      store.chats().summary(sessionId),
    ]);
    const boundary = stored
      ? transcript.findIndex((message) => message.id === stored.throughId)
      : -1;
    const range = transcript.slice(boundary + 1);
    const last = range.at(-1);
    if (!last) return false;
    const summary = await summaries().summarize(
      { agent, employee, runsNow: true },
      {
        previous: stored?.summary ?? null,
        messages: range.map((message) => ({
          from: message.role === "user" ? "chat" : agent.displayName,
          text: message.content,
        })),
      },
    );
    if (summary === null) return false;
    await store.chats().saveSummary(sessionId, {
      summary,
      throughId: last.id,
    });
    return true;
  }

  /**
   * Restarts a session: its summary is written, its process ends, its agent
   * session is forgotten and its inbox begins anew. Concurrent calls share one
   * restart.
   *
   * @param agent - The account of the agent.
   * @param sessionId - The chat session.
   */
  public restart(agent: User, sessionId: string): Promise<void> {
    const running = this.restarts.get(sessionId);
    if (running) return running;
    const task = this.performRestart(agent, sessionId).finally(() => {
      this.restarts.delete(sessionId);
    });
    this.restarts.set(sessionId, task);
    return task;
  }

  /** Stops the answer the agent gives in the session now; the session stays. */
  public async stop(agent: User, sessionId: string): Promise<void> {
    await this.dependencies.acp?.stop(agent, sessionId);
  }

  /** The restart threshold of an agent in percent. */
  public async restartPercent(agentId: string): Promise<number> {
    const settings = await this.dependencies.store
      .chatSessions()
      .settings(agentId);
    return settings?.restartPercent ?? AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT;
  }

  /**
   * Stores what the newest round of a session used.
   *
   * @returns Whether the context reached the threshold of the agent.
   */
  private async recordRound(agent: User, sessionId: string): Promise<boolean> {
    const { acp, store } = this.dependencies;
    const update = await acp?.update(agent, { sessionId });
    // A round that started meanwhile reports its own usage when it ends.
    if (!update || update.job.state === "running") return false;
    const { usage } = update.job;
    const at = this.now();
    await store.chatSessions().recordUsage(sessionId, {
      contextUsed: usage.context?.used ?? null,
      contextSize: usage.context?.size ?? null,
      tokens: usage.tokens?.total ?? 0,
      day: at.slice(0, 10),
      at,
    });
    const session = await store.chatSessions().find(sessionId);
    if (!session) return false;
    const reached = isReached(session, await this.restartPercent(agent.id));
    if (reached) await store.chatSessions().setNeedsRestart(sessionId, true);
    return reached;
  }

  private async performRestart(agent: User, sessionId: string): Promise<void> {
    await this.dependencies.acp?.settled(agent, sessionId);
    try {
      await this.summarize(agent, sessionId);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
    await this.forget(agent, sessionId);
    logEvent({
      level: "info",
      event: "agent.chat_session.restarted",
      component: COMPONENT,
      message: "A chat session of an agent restarted with its summary.",
      metadata: { agentId: agent.id, sessionId },
    });
  }

  /** Ends the process, forgets the agent session and starts the inbox anew. */
  private async forget(agent: User, sessionId: string): Promise<void> {
    const { pool, acpSessions, store } = this.dependencies;
    await pool?.close(sessionId);
    await acpSessions.remove(agent.id, sessionId);
    await store.chatSessions().markRestarted(sessionId, this.now());
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

import { z } from "zod";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_CHAT_SESSION_IDLE_RANGE,
  AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT,
  AGENT_CHAT_SESSION_RESTART_RANGE,
} from "@/definition/AgentChatSession";

import { contextPercentOf } from "./AgentChatSessionLifecycle";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentChatSession } from "@/backend/database/repositories/employee/AgentChatSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";
import type {
  AgentChatSessionAction,
  AgentChatSessionBrief,
  AgentChatSessionOverview,
  AgentChatSessionSettings,
  AgentChatSessionState,
  AgentChatSessionView,
} from "@/definition/AgentChatSession";
import type { User } from "@/definition/User";
import type { AgentChatSessionLifecycle } from "./AgentChatSessionLifecycle";

const COMPONENT = "AgentChatSessionService";

/** What the chat sessions of agents are read and changed with. */
export interface AgentChatSessionServiceDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly lifecycle: Pick<
    AgentChatSessionLifecycle,
    "stop" | "summarize" | "restart"
  >;
  /** The live processes of the sessions; `null` without the ACP path. */
  readonly pool: Pick<PicaAcpSessionPool, "stateOf"> | null;
  /** Whether a round of the session runs now. */
  readonly isWorking: (agent: User, sessionId: string) => Promise<boolean>;
  /** The messages of the session that wait for their turn. */
  readonly waitingMessages: (
    agent: User,
    session: StoredAgentChatSession,
  ) => Promise<number>;
  /** Whether a person takes part in a conversation. */
  readonly isMember: (conversationId: string, userId: string) => Promise<boolean>;
  /** The idle time an agent without one of its own follows. */
  readonly defaultIdleMinutes: () => Promise<number>;
  readonly now?: () => Date;
}

/** What a viewer of the sessions of an agent is. */
export interface AgentChatSessionViewer {
  readonly user: User;
  /** An administrator sees every session of the agent and changes its settings. */
  readonly isAdministrator: boolean;
}

/** What is known of a session without reading its job. */
export interface AgentChatSessionSignals {
  readonly isWorking: boolean;
  readonly waitingMessages: number;
}

const settingsInput = z.object({
  idleMinutes: z.coerce
    .number()
    .int()
    .min(AGENT_CHAT_SESSION_IDLE_RANGE.minimum)
    .max(AGENT_CHAT_SESSION_IDLE_RANGE.maximum),
  restartPercent: z.coerce
    .number()
    .int()
    .min(AGENT_CHAT_SESSION_RESTART_RANGE.minimum)
    .max(AGENT_CHAT_SESSION_RESTART_RANGE.maximum),
});

/**
 * Where a session stands.
 *
 * @param facts - Whether a round runs, whether a process lives and whether
 * the context reached the threshold.
 */
export function agentChatSessionState(facts: {
  readonly isWorking: boolean;
  readonly hasProcess: boolean;
  readonly needsRestart: boolean;
}): AgentChatSessionState {
  if (facts.isWorking) return "working";
  if (facts.needsRestart) return "restart_needed";
  return facts.hasProcess ? "ready" : "resting";
}

/**
 * The chat sessions of agents for their popup and the head of a chat
 * (PAGE-376).
 *
 * @remarks
 * An administrator sees every session of an agent; everybody else only the
 * sessions of chats they take part in: their own direct chat with the agent
 * and the groups they belong to. Stopping, summarizing and restarting a
 * session needs that view; saving the settings of an agent needs an
 * administrator. Summarizing and restarting wait for a model, so they run in
 * the background and the answer shows the state at once.
 */
export class AgentChatSessionService {
  private readonly dependencies: AgentChatSessionServiceDependencies;

  public constructor(dependencies: AgentChatSessionServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the sessions of an agent as the viewer may see them.
   *
   * @throws {AgentEmployeeError} `notFound` for an account that is no agent.
   */
  public async overview(
    viewer: AgentChatSessionViewer,
    agentId: string,
  ): Promise<AgentChatSessionOverview> {
    const agent = await this.requireAgent(agentId);
    const { store } = this.dependencies;
    const day = this.today();
    const [stored, settings, tokensToday] = await Promise.all([
      store.chatSessions().list(agentId),
      this.settings(agentId),
      store.chatSessions().tokensOn(agentId, day),
    ]);
    const visible = await this.visible(viewer, stored);
    const sessions = await Promise.all(
      visible.map((session) => this.view(agent, session)),
    );
    const openSessions = sessions.filter(
      (session) => session.state === "working" || session.state === "ready",
    ).length;
    return {
      agentId,
      agentName: agent.displayName,
      sessions,
      openSessions,
      restingSessions: sessions.length - openSessions,
      tokensToday,
      settings,
      canChangeSettings: viewer.isAdministrator,
    };
  }

  /**
   * Stops, summarizes or restarts one session.
   *
   * @throws {AgentEmployeeError} `notFound` for a session the viewer does not
   * see.
   */
  public async act(
    viewer: AgentChatSessionViewer,
    action: AgentChatSessionAction,
    sessionId: string,
  ): Promise<void> {
    const session = await this.dependencies.store
      .chatSessions()
      .find(sessionId);
    if (!session || !(await this.isVisible(viewer, session)))
      throw new AgentEmployeeError("notFound");
    const agent = await this.requireAgent(session.agentId);
    if (action === "stop") {
      await this.dependencies.lifecycle.stop(agent, sessionId);
      return;
    }
    if (action === "restart")
      await this.dependencies.store
        .chatSessions()
        .setNeedsRestart(sessionId, true);
    this.runInBackground(agent, action, sessionId);
  }

  /**
   * Saves the idle time and the restart threshold of an agent.
   *
   * @throws {AgentEmployeeError} `forbidden` for a viewer who is no
   * administrator, `invalidInput` for a value outside its range, `notFound`
   * for an account that is no agent.
   */
  public async saveSettings(
    viewer: AgentChatSessionViewer,
    agentId: string,
    input: unknown,
  ): Promise<void> {
    if (!viewer.isAdministrator) throw new AgentEmployeeError("forbidden");
    await this.requireAgent(agentId);
    const parsed = settingsInput.safeParse(input);
    if (!parsed.success) throw new AgentEmployeeError("invalidInput");
    const isSaved = await this.dependencies.store
      .chatSessions()
      .saveSettings(agentId, parsed.data);
    if (!isSaved) throw new AgentEmployeeError("notFound");
  }

  /**
   * The session of an agent in its direct chat with a person, for the head of
   * the chat.
   *
   * @returns `undefined` before the first message.
   */
  public async directBrief(
    agentId: string,
    personId: string,
    signals: AgentChatSessionSignals,
  ): Promise<AgentChatSessionBrief | undefined> {
    const conversation = await this.dependencies.store
      .conversations()
      .find(agentId, personId, "chat");
    if (!conversation) return undefined;
    const session = await this.dependencies.store
      .chatSessions()
      .find(conversation.sessionId);
    return session ? this.brief(session, signals) : undefined;
  }

  /**
   * The sessions of the agents in a group, for the head of the chat.
   *
   * @param conversationId - The group.
   * @param signals - What the agent is doing in the group now.
   */
  public async groupBriefs(
    conversationId: string,
    signals: (agentId: string) => AgentChatSessionSignals,
  ): Promise<AgentChatSessionBrief[]> {
    const sessions = await this.dependencies.store
      .chatSessions()
      .forChat("group", conversationId);
    return sessions.map((session) =>
      this.brief(session, signals(session.agentId)),
    );
  }

  /** The short state of a session. */
  public brief(
    session: StoredAgentChatSession,
    signals: AgentChatSessionSignals,
  ): AgentChatSessionBrief {
    return {
      sessionId: session.sessionId,
      agentId: session.agentId,
      state: agentChatSessionState({
        isWorking: signals.isWorking,
        hasProcess:
          (this.dependencies.pool?.stateOf(session.sessionId) ?? null) !== null,
        needsRestart: session.needsRestart,
      }),
      contextPercent: contextPercentOf(session),
      waitingMessages: signals.waitingMessages,
    };
  }

  private async view(
    agent: User,
    session: StoredAgentChatSession,
  ): Promise<AgentChatSessionView> {
    const [isWorking, waitingMessages] = await Promise.all([
      this.dependencies.isWorking(agent, session.sessionId),
      this.dependencies.waitingMessages(agent, session),
    ]);
    return {
      ...this.brief(session, { isWorking, waitingMessages }),
      chat: {
        kind: session.kind,
        id: session.chatId,
        name: session.chatName,
        isConfidential: session.isConfidential,
      },
      tokens: session.tokensTotal,
      lastActivityAt: session.lastActivityAt,
    };
  }

  private async settings(agentId: string): Promise<AgentChatSessionSettings> {
    const stored = await this.dependencies.store
      .chatSessions()
      .settings(agentId);
    return {
      idleMinutes:
        stored?.idleMinutes ?? (await this.dependencies.defaultIdleMinutes()),
      restartPercent:
        stored?.restartPercent ?? AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT,
    };
  }

  private async visible(
    viewer: AgentChatSessionViewer,
    sessions: readonly StoredAgentChatSession[],
  ): Promise<StoredAgentChatSession[]> {
    if (viewer.isAdministrator) return [...sessions];
    const result: StoredAgentChatSession[] = [];
    for (const session of sessions)
      if (await this.isVisible(viewer, session)) result.push(session);
    return result;
  }

  private async isVisible(
    viewer: AgentChatSessionViewer,
    session: StoredAgentChatSession,
  ): Promise<boolean> {
    if (viewer.isAdministrator) return true;
    if (session.kind === "direct") return session.chatId === viewer.user.id;
    return this.dependencies.isMember(session.chatId, viewer.user.id);
  }

  private async requireAgent(agentId: string): Promise<User> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    return agent;
  }

  /** Runs the summary or the restart without holding the request. */
  private runInBackground(
    agent: User,
    action: "summarize" | "restart",
    sessionId: string,
  ): void {
    void withBackgroundDatabaseWork("agent_chat_session_action", async () => {
      if (action === "restart")
        await this.dependencies.lifecycle.restart(agent, sessionId);
      else await this.dependencies.lifecycle.summarize(agent, sessionId);
    }).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
  }

  private today(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString().slice(0, 10);
  }
}

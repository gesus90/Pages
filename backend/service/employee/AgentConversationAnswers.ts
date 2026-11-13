import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";

import { awaitAgentJobAnswer } from "./AgentJobAnswer";

import type { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { User } from "@/definition/User";
import type {
  ConversationAgentRequest,
  ConversationAgentRunner,
} from "@/backend/service/conversation/ConversationAgentReplies";
import type { AgentEmployeeSessions } from "./AgentEmployeeSessions";
import type { AgentMemoryRecorder } from "./AgentMemoryRecorder";

/** How often an answer looks at its job. */
const POLL_MILLISECONDS = 1_500;
/** How long an answer waits for its job before it counts as failed. */
const ANSWER_TIMEOUT_MILLISECONDS = 10 * 60_000;

/** How the memory and the resource view name the conversation of an answer. */
function conversationLabel(request: ConversationAgentRequest): string {
  const { conversation, person } = request;
  return conversation.kind === "group"
    ? `Gruppe „${conversation.name}“`
    : `Chat mit ${person.displayName}`;
}

/** What the answers of agents in conversations run on. */
export interface AgentConversationAnswerDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly sessions: Pick<
    AgentEmployeeSessions,
    "run" | "job" | "admit" | "stopSession" | "steerChat"
  >;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  /** The simulated agent; set only while the simulation is on, never in production. */
  readonly simulation: SimulatedConversationAgent | null;
  /** Keeps `MEMORY.md` current after each answer (PAGE-305); absent records nothing. */
  readonly recorder?: Pick<AgentMemoryRecorder, "record">;
  readonly now?: () => Date;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/**
 * Runs the answer of an agent employee in a conversation (PAGE-276).
 *
 * @remarks
 * The agent must be active. Its answer runs on the
 * ACP path of its sessions as its own account, with its model, instructions
 * and rights, in one session per agent and conversation that answers every
 * round of the conversation until it rests too long (PAGE-335). While the
 * simulation is on, the simulated agent answers instead, after the same
 * checks and within the same limits of concurrent sessions, and no model
 * provider is asked. A stopped answer ends only its own session (PAGE-304).
 * Every answer updates the memory of the agent at once (PAGE-305).
 */
export class AgentConversationAnswers implements ConversationAgentRunner {
  private readonly dependencies: AgentConversationAnswerDependencies;

  public constructor(dependencies: AgentConversationAnswerDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Answers one message of a conversation as the agent.
   *
   * @throws {AgentEmployeeError} `inactive`, `notFound`,
   * `unavailable` or another refusal of the session.
   */
  public async answer(request: ConversationAgentRequest): Promise<string> {
    const agent = await this.dependencies.users.findById(request.agent.id);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    if (!agent.isActive) throw new AgentEmployeeError("inactive");
    const employee = await this.dependencies.store.employees().find(agent.id);
    if (!employee) throw new AgentEmployeeError("notFound");
    const { simulation } = this.dependencies;
    if (simulation) {
      const simulated = await this.simulate(simulation, agent, request);
      this.record(agent, request, { answer: simulated, sessionId: null });
      return simulated;
    }
    const { signal } = request;
    const started = await this.dependencies.sessions.run({
      agent,
      employee,
      person: request.person,
      purpose: "conversation",
      conversationId: request.conversation.id,
      conversationLabel: conversationLabel(request),
      text: request.prompt,
      clientMessageId: null,
      signal,
      onQueued: request.onQueued,
      onAdmitted: request.onAdmitted,
    });
    if (!started) throw new AgentEmployeeError("busy");
    // The round reached the session: its next round carries only what is newer (PAGE-376).
    await this.advance(started.sessionId, request);
    const stop = (): void => {
      void this.dependencies.sessions
        .stopSession(agent, started.sessionId)
        .catch((error: unknown) => {
          logCaughtError("AgentConversationAnswers", error);
        });
    };
    signal?.addEventListener("abort", stop, { once: true });
    try {
      if (signal?.aborted) stop();
      const answer = await awaitAgentJobAnswer(
        { agent, sessionId: started.sessionId, jobId: started.start.job.id },
        {
          sessions: this.dependencies.sessions,
          messages: this.dependencies.messages,
          pollMilliseconds: POLL_MILLISECONDS,
          timeoutMilliseconds: ANSWER_TIMEOUT_MILLISECONDS,
          now: () => this.dependencies.now?.() ?? new Date(),
          wait: this.dependencies.wait,
        },
      );
      this.record(agent, request, { answer, sessionId: started.sessionId });
      return answer;
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  }

  /**
   * Hands the round to the answer the agent is giving in the conversation
   * now (PAGE-376); the new messages join it and no second answer starts.
   *
   * @returns Whether the running answer took the round.
   */
  public async steer(request: ConversationAgentRequest): Promise<boolean> {
    if (this.dependencies.simulation) return false;
    const steered = await this.dependencies.sessions.steerChat(
      request.agent,
      { purpose: "conversation", conversationId: request.conversation.id },
      request.prompt,
    );
    if (steered) await this.advanceByConversation(request);
    return steered;
  }

  /**
   * The newest message of the conversation the agent's session received; `0`
   * before its first round (PAGE-376).
   */
  public async deliveredThrough(
    agentId: string,
    conversationId: string,
  ): Promise<number> {
    const session = await this.dependencies.store
      .conversations()
      .find(agentId, conversationId, "conversation");
    return session
      ? this.dependencies.store.chatSessions().delivered(session.sessionId)
      : 0;
  }

  /** Records that the session received the conversation up to the answered message. */
  private async advance(
    sessionId: string,
    request: ConversationAgentRequest,
  ): Promise<void> {
    if (request.throughSequence === undefined) return;
    await this.dependencies.store
      .chatSessions()
      .saveDelivered(sessionId, request.throughSequence);
  }

  private async advanceByConversation(
    request: ConversationAgentRequest,
  ): Promise<void> {
    const session = await this.dependencies.store
      .conversations()
      .find(request.agent.id, request.conversation.id, "conversation");
    if (session) await this.advance(session.sessionId, request);
  }

  /** Hands the answer to the memory, which updates it in the background (PAGE-305). */
  private record(
    agent: User,
    request: ConversationAgentRequest,
    result: { readonly answer: string; readonly sessionId: string | null },
  ): void {
    const { conversation, person } = request;
    void this.dependencies.recorder?.record({
      agent,
      chat: { kind: "conversation", conversationId: conversation.id },
      chatLabel: conversationLabel(request),
      personName: person.displayName,
      message: request.lastMessage,
      answer: result.answer,
      sessionId: result.sessionId,
    });
  }

  /** The simulated answer, holding a place among the limits while it runs. */
  private async simulate(
    simulation: SimulatedConversationAgent,
    agent: User,
    request: ConversationAgentRequest,
  ): Promise<string> {
    const slot = await this.dependencies.sessions.admit(agent.id, {
      signal: request.signal,
      onQueued: request.onQueued,
    });
    request.onAdmitted?.();
    try {
      return await simulation.answer({
        agentName: agent.displayName,
        lastMessage: request.lastMessage,
        signal: request.signal,
      });
    } finally {
      slot.release();
    }
  }
}

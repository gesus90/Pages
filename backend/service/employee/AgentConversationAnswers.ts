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

/** What the answers of agents in conversations run on. */
export interface AgentConversationAnswerDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly sessions: Pick<
    AgentEmployeeSessions,
    "run" | "job" | "admit" | "stopSession"
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
 * and rights, in one session per agent and conversation. While the
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
      text: request.prompt,
      clientMessageId: null,
      signal,
      onQueued: request.onQueued,
      onAdmitted: request.onAdmitted,
    });
    if (!started) throw new AgentEmployeeError("busy");
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
      chatLabel:
        conversation.kind === "group"
          ? `Gruppe „${conversation.name}“`
          : `Chat mit ${person.displayName}`,
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

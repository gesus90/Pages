import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AutomationAgentBusyError } from "@/backend/service/automation/AutomationAgentWorker";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { CONVERSATION_TEXT_MAXIMUM_LENGTH } from "@/definition/Conversation";

import { awaitAgentJobAnswer } from "./AgentJobAnswer";
import { AgentAutomationTarget } from "./AgentAutomationTarget";

import type { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AutomationAgentRunner,
  AutomationAgentTurn,
} from "@/backend/service/automation/AutomationAgentWorker";
import type { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import type { User } from "@/definition/User";
import type { AgentJobRequest, AgentEmployeeSessions } from "./AgentEmployeeSessions";
import type { AutomationTarget } from "./AgentAutomationTarget";

/** How often a turn looks at its job. */
const POLL_MILLISECONDS = 1_500;
/** How long an automation turn may take before it counts as failed. */
const TURN_TIMEOUT_MILLISECONDS = 60 * 60_000;

/** What the turns of automations run on. */
export interface AgentAutomationTurnDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly sessions: Pick<AgentEmployeeSessions, "run" | "job">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  /** Stores the result of a run in a group as the agent's message (PAGE-376). */
  readonly chatPoster?: Pick<AgentChatService, "postResult">;
  /** The simulated agent; set only while the simulation is on, never in production. */
  readonly simulation: SimulatedConversationAgent | null;
  readonly now?: () => Date;
}

/** One run as the turn starts it. */
interface TurnRequest {
  readonly agentId: string;
  readonly creatorId: string;
  readonly sessionKey: string;
  readonly prompt: string;
  readonly chat?: string | null;
  readonly runKey?: string;
}

/**
 * Wakes an agent employee for an automation (PAGE-297, PAGE-376).
 *
 * @remarks
 * An automation runs in the session of its target chat (PAGE-376): `@Agentname`
 * and no target name the direct chat of the automation's owner with the
 * agent, `[[Chatname]]` a group the owner and the agent belong to. The input
 * goes into the one session of that chat, as the agent's own account with
 * its model, instructions and rights, and its result is a message of the agent
 * in that chat. An owner who is no person has no direct chat; the turn then
 * keeps a session of its own, apart from every chat. No human or administrator
 * token enters the session. While the agent works on another job in the chat
 * the turn is refused as busy and waits in the agent's queue. While the
 * simulation is on, the simulated agent answers and no model provider is asked.
 */
export class AgentAutomationTurns implements AutomationAgentRunner {
  private readonly dependencies: AgentAutomationTurnDependencies;
  private readonly target: AgentAutomationTarget;

  public constructor(dependencies: AgentAutomationTurnDependencies) {
    this.dependencies = dependencies;
    this.target = new AgentAutomationTarget(dependencies.store);
  }

  /**
   * Starts the turn of an agent.
   *
   * @throws {AutomationAgentBusyError} While the agent is busy.
   * @throws {AutomationTargetError} `target_chat_invalid` or `target_chat_not_found`.
   * @throws {AgentEmployeeError} `notFound`, `inactive` or `unavailable`.
   */
  public async start(request: TurnRequest): Promise<AutomationAgentTurn> {
    const { users, store, simulation } = this.dependencies;
    const agent = await users.findById(request.agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    if (!agent.isActive) throw new AgentEmployeeError("inactive");
    const employee = await store.employees().find(agent.id);
    if (!employee) throw new AgentEmployeeError("notFound");
    const owner = await users.findById(request.creatorId);
    const target = await this.target.resolve({
      agent,
      owner,
      chat: request.chat,
    });
    if (simulation)
      return {
        sessionId: `simulation:${request.sessionKey}`,
        answer: simulation.answer({
          agentName: agent.displayName,
          lastMessage: request.prompt,
        }),
      };
    const started = await this.run(
      { ...this.job(target, request), agent, employee },
      request,
    );
    return {
      sessionId: started.sessionId,
      answer: this.answer(
        { agent, sessionId: started.sessionId, jobId: started.start.job.id },
        { target, request },
      ),
    };
  }

  /** The kind of session the target gives the turn. */
  private job(
    target: AutomationTarget,
    request: TurnRequest,
  ): Pick<
    AgentJobRequest,
    "person" | "purpose" | "conversationId" | "conversationLabel"
  > {
    if (target.kind === "direct")
      return { person: target.person, purpose: "chat" };
    if (target.kind === "group")
      return {
        person: target.person,
        purpose: "conversation",
        conversationId: target.conversationId,
        conversationLabel: `Gruppe „${target.name}“`,
      };
    return {
      person: null,
      purpose: "automation",
      conversationId: request.sessionKey,
    };
  }

  /** Waits for the answer; in a group it is stored there as the agent's message. */
  private async answer(
    job: { readonly agent: User; readonly sessionId: string; readonly jobId: string },
    context: { readonly target: AutomationTarget; readonly request: TurnRequest },
  ): Promise<string> {
    const answer = await awaitAgentJobAnswer(job, {
      sessions: this.dependencies.sessions,
      messages: this.dependencies.messages,
      pollMilliseconds: POLL_MILLISECONDS,
      timeoutMilliseconds: TURN_TIMEOUT_MILLISECONDS,
      now: () => this.dependencies.now?.() ?? new Date(),
    });
    const { target, request } = context;
    const text = Array.from(redactCredentials(answer.trim()))
      .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
      .join("");
    // A direct chat holds the answer already: the job stores it in the chat session.
    if (target.kind === "group" && text !== "")
      await this.dependencies.chatPoster?.postResult(job.agent.id, {
        conversationId: target.conversationId,
        key: request.runKey ?? request.sessionKey,
        text,
      });
    return answer;
  }

  private async run(
    parties: Pick<
      AgentJobRequest,
      | "agent"
      | "employee"
      | "person"
      | "purpose"
      | "conversationId"
      | "conversationLabel"
    >,
    request: { readonly prompt: string },
  ): Promise<NonNullable<Awaited<ReturnType<AgentEmployeeSessions["run"]>>>> {
    try {
      const started = await this.dependencies.sessions.run({
        ...parties,
        text: request.prompt,
        clientMessageId: null,
        isScheduled: true,
      });
      if (!started) throw new AutomationAgentBusyError();
      return started;
    } catch (error: unknown) {
      if (error instanceof AgentEmployeeError && error.code === "busy")
        throw new AutomationAgentBusyError();
      throw error;
    }
  }
}

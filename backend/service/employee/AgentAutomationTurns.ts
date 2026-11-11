import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AutomationAgentBusyError } from "@/backend/service/automation/AutomationAgentWorker";

import { awaitAgentJobAnswer } from "./AgentJobAnswer";

import type { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AutomationAgentRunner,
  AutomationAgentTurn,
} from "@/backend/service/automation/AutomationAgentWorker";
import type { AgentEmployeeSessions } from "./AgentEmployeeSessions";

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
  /** The simulated agent; set only while the simulation is on, never in production. */
  readonly simulation: SimulatedConversationAgent | null;
  readonly now?: () => Date;
}

/**
 * Wakes an agent employee for an automation (PAGE-297).
 *
 * @remarks
 * The input goes into the agent's own automation session, apart from every
 * chat with a person, and starts a turn over ACP as the agent's account with
 * its model, instructions and rights. No human or administrator token enters
 * the session; whether and where the agent reports, it decides with its own
 * chat tools. While the agent works on another job the turn is refused as
 * busy and waits in the agent's queue. While the simulation is on, the
 * simulated agent answers and no model provider is asked.
 */
export class AgentAutomationTurns implements AutomationAgentRunner {
  private readonly dependencies: AgentAutomationTurnDependencies;

  public constructor(dependencies: AgentAutomationTurnDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Starts the turn of an agent.
   *
   * @throws {AutomationAgentBusyError} While the agent is busy.
   * @throws {AgentEmployeeError} `notFound`, `inactive` or `unavailable`.
   */
  public async start(request: {
    readonly agentId: string;
    readonly creatorId: string;
    readonly sessionKey: string;
    readonly prompt: string;
  }): Promise<AutomationAgentTurn> {
    const { users, store, simulation } = this.dependencies;
    const agent = await users.findById(request.agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    if (!agent.isActive) throw new AgentEmployeeError("inactive");
    const employee = await store.employees().find(agent.id);
    if (!employee) throw new AgentEmployeeError("notFound");
    if (simulation)
      return {
        sessionId: `simulation:${request.sessionKey}`,
        answer: simulation.answer({
          agentName: agent.displayName,
          lastMessage: request.prompt,
        }),
      };
    const creator = await users.findById(request.creatorId);
    const started = await this.run(
      { agent, employee, person: creator?.isAgent ? null : creator },
      request,
    );
    return {
      sessionId: started.sessionId,
      answer: awaitAgentJobAnswer(
        { agent, sessionId: started.sessionId, jobId: started.start.job.id },
        {
          sessions: this.dependencies.sessions,
          messages: this.dependencies.messages,
          pollMilliseconds: POLL_MILLISECONDS,
          timeoutMilliseconds: TURN_TIMEOUT_MILLISECONDS,
          now: () => this.dependencies.now?.() ?? new Date(),
        },
      ),
    };
  }

  private async run(
    parties: Pick<
      Parameters<AgentEmployeeSessions["run"]>[0],
      "agent" | "employee" | "person"
    >,
    request: { readonly sessionKey: string; readonly prompt: string },
  ): Promise<NonNullable<Awaited<ReturnType<AgentEmployeeSessions["run"]>>>> {
    try {
      const started = await this.dependencies.sessions.run({
        ...parties,
        purpose: "automation",
        conversationId: request.sessionKey,
        text: request.prompt,
        clientMessageId: null,
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

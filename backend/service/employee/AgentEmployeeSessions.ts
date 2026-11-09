import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { acpRunOptions } from "@/definition/AgentConfiguration";
import { CHAT_LIMITS } from "@/definition/Chat";

import { employeeAcpRunner } from "../chat/acp/EmployeeAcpRunners";
import { createAgentEmployeeInstructions } from "./AgentEmployeeInstructions";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentConversationPurpose } from "@/backend/database/repositories/employee/AgentConversationRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type { PicaAcpService, PicaAcpStart } from "../chat/acp/PicaAcpService";
import type { ChatJob, ChatJobStart } from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { AgentMemoryService } from "./AgentMemoryService";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the sessions of agents run on. */
export interface AgentEmployeeSessionDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  readonly models: AgentEmployeeModels;
  readonly activity: AgentActivityService;
  readonly memory: AgentMemoryService;
  /** Pica's ACP path; `null` where the server runs no ACP chat. */
  readonly acp: Pick<
    PicaAcpService,
    "start" | "steer" | "update" | "stop"
  > | null;
  /** An unused ID for a new chat session. */
  readonly createSessionId: () => string;
  readonly today?: () => string;
}

/** A message a person sends to an agent. */
interface AgentMessage {
  readonly agentId: string;
  readonly text: string;
  readonly clientMessageId: string | null;
}

/** What a job of an agent answers and with whom. */
export interface AgentJobRequest {
  readonly agent: User;
  readonly employee: StoredAgentEmployee;
  /** The person the agent talks with; `null` for a learning run. */
  readonly person: User | null;
  readonly purpose: AgentConversationPurpose;
  readonly text: string;
  readonly clientMessageId: string | null;
}

function readMessage(input: unknown): AgentMessage {
  const fields = readAgentObject(input);
  const { agentId, text, clientMessageId } = fields;
  if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
    throw new AgentEmployeeError("invalidInput");
  if (typeof text !== "string") throw new AgentEmployeeError("invalidInput");
  const trimmed = text.trim();
  if (
    trimmed === "" ||
    Array.from(trimmed).length > CHAT_LIMITS.messageCharacters ||
    redactCredentials(trimmed) !== trimmed
  )
    throw new AgentEmployeeError("invalidInput");
  return {
    agentId,
    text: trimmed,
    clientMessageId:
      typeof clientMessageId === "string" && IDENTIFIER.test(clientMessageId)
        ? clientMessageId
        : null,
  };
}

/**
 * Sessions of agent employees over ACP (PAGE-266).
 *
 * @remarks
 * A session runs on Pica's ACP path, but as the agent's own account: its
 * conversation belongs to the agent, so every tool call is checked against
 * the agent's role, departments and project memberships. It runs with the
 * model and access stored for the agent; full access only inside the
 * isolation the ACP execution never runs YOLO without. `SOUL.md` and
 * `AGENT.md` open every instruction, `MEMORY.md` follows as data. A reached
 * cost limit refuses the start, and ends a running session at its next
 * turn or tool call.
 */
export class AgentEmployeeSessions {
  private readonly dependencies: AgentEmployeeSessionDependencies;

  public constructor(dependencies: AgentEmployeeSessionDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Sends a person's message to an agent: into its running job, or as a new one.
   *
   * @throws {AgentEmployeeError} `inactive`, `costLimitReached`, `busy`,
   * `unavailable` or `invalidInput`.
   */
  public async send(person: User, input: unknown): Promise<void> {
    const message = readMessage(input);
    const { agent, employee } = await this.requireAgent(message.agentId);
    await this.run({
      agent,
      employee,
      person,
      purpose: "chat",
      text: message.text,
      clientMessageId: message.clientMessageId,
    });
  }

  /** Stops the running job of the person's conversation with an agent. */
  public async stop(person: User, agentId: unknown): Promise<void> {
    if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
      throw new AgentEmployeeError("invalidInput");
    const acp = this.dependencies.acp;
    const agent = await this.dependencies.users.findById(agentId);
    if (!acp || agent?.isAgent !== true) return;
    const conversation = await this.dependencies.store
      .conversations()
      .find(agentId, person.id, "chat");
    if (conversation) await acp.stop(agent, conversation.sessionId);
  }

  /** Whether a job of a conversation of the agent runs now. */
  public async isWorking(agent: User, sessionId: string): Promise<boolean> {
    const acp = this.dependencies.acp;
    if (!acp || !agent.isActive) return false;
    const update = await acp.update(agent, { sessionId });
    return update?.job.state === "running";
  }

  /** Reads a job of an agent's conversation, for a learning run that waits for its end. */
  public async job(
    agent: User,
    sessionId: string,
    jobId: string,
  ): Promise<ChatJob | null> {
    const update = await this.dependencies.acp?.update(agent, {
      sessionId,
      jobId,
    });
    return update?.job ?? null;
  }

  /**
   * Starts a job of an agent, or steers the message into its running one.
   *
   * @returns The started job with its session, or `null` for a steered message.
   */
  public async run(request: AgentJobRequest): Promise<{
    readonly start: ChatJobStart;
    readonly sessionId: string;
  } | null> {
    const acp = this.dependencies.acp;
    if (!acp) throw new AgentEmployeeError("unavailable");
    const { agent, employee } = request;
    await this.dependencies.activity.requireBelowLimit(
      employee,
      request.purpose === "learning" ? "learning" : "session",
    );
    const conversation = await this.dependencies.store.conversations().ensure(
      {
        agentId: agent.id,
        personId: request.person?.id ?? agent.id,
        purpose: request.purpose,
      },
      this.dependencies.createSessionId(),
    );
    const chatRequest = {
      clientMessageId: request.clientMessageId,
      sessionId: conversation.sessionId,
      text: request.text,
      attachmentIds: [],
    };
    try {
      if (request.purpose === "chat" && (await acp.steer(agent, chatRequest)))
        return null;
      const assignment = await this.assignment(employee);
      const start = await acp.start({
        actor: agent,
        request: chatRequest,
        agent: assignment,
        brief: await this.brief(request, conversation.sessionId),
        employee: this.employeeRun(agent, employee, assignment),
      });
      return { start, sessionId: conversation.sessionId };
    } catch (error: unknown) {
      throw this.translate(error);
    }
  }

  private async requireAgent(agentId: string): Promise<{
    readonly agent: User;
    readonly employee: StoredAgentEmployee;
  }> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    if (!agent.isActive) throw new AgentEmployeeError("inactive");
    const employee = await this.dependencies.store.employees().find(agentId);
    if (!employee) throw new AgentEmployeeError("notFound");
    return { agent, employee };
  }

  private async assignment(
    employee: StoredAgentEmployee,
  ): Promise<ResolvedAgentAssignment> {
    const resolved = await this.dependencies.models.resolve(employee);
    return { ...resolved, run: acpRunOptions(employee.access, 0) };
  }

  private async brief(
    request: AgentJobRequest,
    sessionId: string,
  ): Promise<PicaAcpStart["brief"]> {
    const { agent, employee, person } = request;
    const snapshot = await this.dependencies.authorization.snapshot();
    const account = snapshot.accounts.find(
      (candidate) => candidate.userId === agent.id,
    );
    const position = (
      await this.dependencies.store.identities().jobTitles()
    ).get(agent.id);
    const settings = person
      ? await this.dependencies.languages.findByUserId(person.id)
      : null;
    return {
      instructions: createAgentEmployeeInstructions({
        name: agent.displayName,
        position: position ?? null,
        roleName: account?.role?.name ?? null,
        soul: employee.soul,
        instructions: employee.instructions,
        memory: employee.memory,
        access: employee.access,
        personName: person?.displayName ?? null,
      }),
      prompt: {
        personName: person?.displayName ?? agent.displayName,
        interfaceLanguage: settings?.language ?? "de",
        today:
          this.dependencies.today?.() ?? new Date().toISOString().slice(0, 10),
        // A learning run reads its sources from the message alone.
        history:
          request.purpose === "chat"
            ? await this.dependencies.messages.messages(sessionId)
            : [],
        summary: null,
        nativeTools: true,
        assistantName: agent.displayName,
      },
    };
  }

  private employeeRun(
    agent: User,
    employee: StoredAgentEmployee,
    assignment: ResolvedAgentAssignment,
  ): NonNullable<PicaAcpStart["employee"]> {
    return {
      runner: employeeAcpRunner(assignment, employee.access),
      requireCurrent: () => this.requireCurrent(agent.id, employee.revision),
      requireConnection: (connectionId) =>
        connectionId === employee.connectionId
          ? Promise.resolve()
          : Promise.reject(new ChatError("contextChanged")),
      searchMemory: async (query) => ({
        entries: await this.dependencies.memory.search(agent.id, query),
      }),
    };
  }

  /**
   * Checks a running job against the current state of its agent: still
   * active, unchanged and below its cost limit; otherwise the job ends.
   */
  private async requireCurrent(
    agentId: string,
    revision: number,
  ): Promise<void> {
    const [agent, employee] = await Promise.all([
      this.dependencies.users.findById(agentId),
      this.dependencies.store.employees().find(agentId),
    ]);
    if (!agent?.isActive || agent.isAgent !== true || !employee)
      throw new ChatError("accessDenied");
    if (employee.revision !== revision) throw new ChatError("contextChanged");
    await this.dependencies.activity.requireBelowLimit(employee, "session");
  }

  private translate(error: unknown): unknown {
    if (error instanceof AgentEmployeeError) return error;
    if (error instanceof AgentExecutionError && error.code === "requestBusy")
      return new AgentEmployeeError("busy");
    if (error instanceof ChatError)
      return new AgentEmployeeError(
        error.code === "acpPermissionModeUnsupported"
          ? "accessUnsupported"
          : "unavailable",
      );
    return error;
  }
}

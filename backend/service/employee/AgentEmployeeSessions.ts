import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { acpRunOptions } from "@/definition/AgentConfiguration";
import { CHAT_LIMITS } from "@/definition/Chat";
import { hasHostTools } from "@/definition/AgentEmployee";

import {
  employeeAcpRunner,
  employeeRunMode,
} from "../chat/acp/EmployeeAcpRunners";
import { createAgentEmployeeInstructions } from "./AgentEmployeeInstructions";
import { foldJobToolCalls } from "./AgentToolCallView";

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
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { AgentMemoryService } from "./AgentMemoryService";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentHostFiles } from "./AgentHostFiles";
import type { AgentToolCallView } from "./AgentToolCallView";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;
/** Jobs of a conversation whose tool calls the chat page shows. */
const TOOL_CALL_JOBS = 20;
/** Journal entries of one job the chat page reads at most for its tool calls. */
const TOOL_CALL_ENTRIES = 2_000;

/** What the sessions of agents run on. */
export interface AgentEmployeeSessionDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  readonly models: AgentEmployeeModels;
  readonly memory: AgentMemoryService;
  /** Pica's ACP path; `null` where the server runs no ACP chat. */
  readonly acp: Pick<
    PicaAcpService,
    "start" | "steer" | "update" | "stop" | "cancelTool" | "journals"
  > | null;
  /** The MCP servers of the host for "Arbeitsplatz" and YOLO (PAGE-303); absent gives none. */
  readonly accessEnvironment?: Pick<
    AgentAccessEnvironmentService,
    "chatServers"
  >;
  /** Attaches files of the working folder with the agent's rights (PAGE-303); absent offers no such tool. */
  readonly hostFiles?: Pick<AgentHostFiles, "attach">;
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
  /** The stored conversation an answer belongs to (PAGE-276); its session is kept per agent and conversation. */
  readonly conversationId?: string;
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
 * `AGENT.md` open every instruction, `MEMORY.md` follows as data. A change
 * of the agent ends a running session at its next turn or tool call.
 */
export class AgentEmployeeSessions {
  private readonly dependencies: AgentEmployeeSessionDependencies;

  public constructor(dependencies: AgentEmployeeSessionDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Sends a person's message to an agent: into its running job, or as a new one.
   *
   * @throws {AgentEmployeeError} `inactive`, `busy`,
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

  /**
   * Cancels the running tool call in the person's conversation with an agent;
   * the agent answers with what it has (PAGE-303).
   *
   * @returns Whether a running call was cancelled.
   */
  public async cancelTool(person: User, agentId: unknown): Promise<boolean> {
    if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
      throw new AgentEmployeeError("invalidInput");
    const acp = this.dependencies.acp;
    const agent = await this.dependencies.users.findById(agentId);
    if (!acp || agent?.isAgent !== true) return false;
    const conversation = await this.dependencies.store
      .conversations()
      .find(agentId, person.id, "chat");
    return conversation ? acp.cancelTool(agent, conversation.sessionId) : false;
  }

  /**
   * The tool calls of the newest jobs of a conversation of the agent, by the
   * answer they belong to (PAGE-303).
   *
   * @returns Every call with input and result as the job journaled them;
   * empty without ACP or a job.
   */
  public async toolCalls(
    agent: User,
    sessionId: string,
  ): Promise<AgentToolCallView> {
    const journals =
      (await this.dependencies.acp?.journals(agent, sessionId, {
        jobs: TOOL_CALL_JOBS,
        entries: TOOL_CALL_ENTRIES,
      })) ?? [];
    return foldJobToolCalls(journals);
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
    const conversation = await this.dependencies.store.conversations().ensure(
      {
        agentId: agent.id,
        personId: request.conversationId ?? request.person?.id ?? agent.id,
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
        employee: await this.employeeRun(agent, employee, assignment),
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
    return {
      ...resolved,
      run: acpRunOptions(employeeRunMode(employee.access), 0),
    };
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

  /**
   * The runner of a job with the agent's access level (PAGE-303): the host's
   * MCP servers, read anew for every job, and the file tools only with host
   * tools.
   */
  private async employeeRun(
    agent: User,
    employee: StoredAgentEmployee,
    assignment: ResolvedAgentAssignment,
  ): Promise<NonNullable<PicaAcpStart["employee"]>> {
    const { access } = employee;
    const hostServers =
      (await this.dependencies.accessEnvironment?.chatServers(
        assignment.connection.provider,
        access,
      )) ?? [];
    const { hostFiles } = this.dependencies;
    return {
      runner: employeeAcpRunner(assignment, access, hostServers),
      ...(hostFiles && hasHostTools(access)
        ? {
            attachFile: (directory, target, file) =>
              hostFiles.attach(agent, { directory, file, target }),
          }
        : {}),
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
   * active and unchanged; otherwise the job ends.
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

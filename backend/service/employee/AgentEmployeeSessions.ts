import { randomUUID } from "node:crypto";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { acpRunOptions } from "@/definition/AgentConfiguration";
import { CHAT_LIMITS } from "@/definition/Chat";
import { hasHostTools } from "@/definition/AgentEmployee";

import {
  employeeAcpRunner,
  employeeRunMode,
} from "../chat/acp/EmployeeAcpRunners";
import { AgentChatContext } from "./AgentChatContext";
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
import type {
  PicaAcpEmployeeRun,
  PicaAcpRequest,
  PicaAcpService,
  PicaAcpStart,
} from "../chat/acp/PicaAcpService";
import type { AgentChatTools } from "@/definition/AgentChat";
import type {
  ChatJob,
  ChatJobStart,
  ChatSteerStatus,
} from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { AgentMemoryService } from "./AgentMemoryService";
import type { AgentMemoryRecorder } from "./AgentMemoryRecorder";
import type { AgentMemoryAudience } from "./AgentMemorySharing";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentHostFiles } from "./AgentHostFiles";
import type { AgentToolCallView } from "./AgentToolCallView";
import type {
  AgentSessionSlot,
  AgentSessionSlotRequest,
  AgentSessionSlots,
} from "./AgentSessionSlots";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;
/** Jobs of a conversation whose tool calls the chat page shows. */
const TOOL_CALL_JOBS = 20;
/** Journal entries of one job the chat page reads at most for its tool calls. */
const TOOL_CALL_ENTRIES = 2_000;
/** Starts of one message that may find its chat still closing the previous job. */
const SESSION_BUSY_ATTEMPTS = 3;

/** Steers that wait for their own turn of the running job rather than joining the current one. */
const WAITING_STEERS: ReadonlySet<ChatSteerStatus> = new Set([
  "pending",
  "delivered",
  "followUp",
]);

/** The place of a session without limits, for a server without them. */
const UNLIMITED_SLOT: AgentSessionSlot = {
  hasWaited: false,
  release: () => undefined,
};

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
    | "start"
    | "steer"
    | "update"
    | "stop"
    | "cancelTool"
    | "journals"
    | "settled"
    | "activity"
  > | null;
  /** The limits of concurrent sessions (PAGE-304); absent runs every session at once. */
  readonly slots?: Pick<AgentSessionSlots, "acquire">;
  /** The MCP servers of the host for "Arbeitsplatz" and YOLO (PAGE-303); absent gives none. */
  readonly accessEnvironment?: Pick<
    AgentAccessEnvironmentService,
    "chatServers"
  >;
  /** Attaches files of the working folder with the agent's rights (PAGE-303); absent offers no such tool. */
  readonly hostFiles?: Pick<AgentHostFiles, "attach">;
  /** Keeps `MEMORY.md` current after each answer of a direct chat (PAGE-305); absent records nothing. */
  readonly recorder?: Pick<AgentMemoryRecorder, "record">;
  /**
   * The Pages tools to read chats and send messages (PAGE-311). A function,
   * because the conversations are wired after the sessions; `null` where none.
   */
  readonly agentChat?: () => AgentChatTools | null;
  /** An unused ID for a new chat session. */
  readonly createSessionId: () => string;
  /**
   * Reads the stored context of a group as the agent's own account
   * (PAGE-296); offered to the agent as `read_conversation_context`.
   */
  readonly conversationContext?: {
    readForAgent(agentId: string, input: unknown): Promise<unknown>;
  };
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
  /** How the resource view names the conversation of a kept session (PAGE-335). */
  readonly conversationLabel?: string;
  readonly text: string;
  readonly clientMessageId: string | null;
  /** Ends the wait of the message in the queue (PAGE-304). */
  readonly signal?: AbortSignal;
  /** Called once when the message waits for a free place among the limits. */
  readonly onQueued?: () => void;
  /** Called once when the message got its place and its answer begins. */
  readonly onAdmitted?: () => void;
}

/** A message of a person to an agent that waits for a free place (PAGE-304). */
export interface QueuedAgentMessage {
  readonly id: string;
  readonly text: string;
}

interface WaitingMessage extends QueuedAgentMessage {
  readonly controller: AbortController;
}

/** The key of the direct chat of a person with an agent. */
function chatKey(agentId: string, personId: string): string {
  return `${agentId}:${personId}`;
}

/**
 * The session a chat keeps between its rounds (PAGE-335): a direct chat and
 * a conversation answer every round through one session of the agent; a run
 * of the agent's own starts a session of its own each time.
 */
function keptSessionOf(
  request: AgentJobRequest,
): PicaAcpEmployeeRun["keptSession"] {
  const { purpose, person, employee } = request;
  if (purpose !== "chat" && purpose !== "conversation") return undefined;
  const conversation =
    request.conversationLabel ??
    (person ? `Chat mit ${person.displayName}` : request.agent.displayName);
  return { conversation, revision: employee.revision };
}

function isSessionBusy(error: unknown): boolean {
  return error instanceof AgentExecutionError && error.code === "requestBusy";
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
 *
 * Every chat of an agent has its own session with its own working directory
 * and history (PAGE-304): the direct chat per person, every conversation per
 * conversation. Sessions of different chats run side by side. A message to
 * a chat whose job runs joins that job; above the limits of concurrent
 * sessions a message waits for a free place and is never refused. A direct
 * chat and a conversation keep their native session between rounds
 * (PAGE-335): every further round becomes its next turn, and rounds of one
 * chat run one after another, never as a second process.
 */
export class AgentEmployeeSessions {
  private readonly dependencies: AgentEmployeeSessionDependencies;
  private readonly context: AgentChatContext;
  /** Direct messages that wait for a free place, by direct chat. */
  private readonly waiting = new Map<string, WaitingMessage[]>();

  public constructor(dependencies: AgentEmployeeSessionDependencies) {
    this.dependencies = dependencies;
    this.context = new AgentChatContext({
      store: dependencies.store,
      messages: dependencies.messages,
      memory: dependencies.memory,
    });
  }

  /**
   * Sends a person's message to an agent: into its running job, or as a new one.
   *
   * @remarks
   * Above the limits of concurrent sessions the message waits in the queue
   * of the direct chat and this call returns; the answer starts once a place
   * is free (PAGE-304).
   *
   * @throws {AgentEmployeeError} `inactive`, `busy`,
   * `unavailable` or `invalidInput`.
   */
  public async send(person: User, input: unknown): Promise<void> {
    const message = readMessage(input);
    const { agent, employee } = await this.requireAgent(message.agentId);
    const key = chatKey(agent.id, person.id);
    const entry: WaitingMessage = {
      id: message.clientMessageId ?? randomUUID(),
      text: message.text,
      controller: new AbortController(),
    };
    let markQueued = (): void => undefined;
    const queued = new Promise<"queued">((resolve) => {
      markQueued = () => resolve("queued");
    });
    // The answer outlives the request when it has to wait for a place.
    const work = withBackgroundDatabaseWork("agent_chat_message", () =>
      this.run({
        agent,
        employee,
        person,
        purpose: "chat",
        text: message.text,
        clientMessageId: message.clientMessageId,
        signal: entry.controller.signal,
        onQueued: () => {
          this.waiting.set(key, [...(this.waiting.get(key) ?? []), entry]);
          markQueued();
        },
        onAdmitted: () => this.forgetWaiting(key, entry),
      }),
    );
    const first = await Promise.race([
      work.then(() => "done" as const),
      queued,
    ]);
    if (first === "queued")
      void work
        .catch((error: unknown) => {
          logCaughtError("AgentEmployeeSessions", error);
        })
        .finally(() => this.forgetWaiting(key, entry));
  }

  /** The person's messages to an agent that wait for a free place, oldest first. */
  public queuedMessages(
    agentId: string,
    personId: string,
  ): readonly QueuedAgentMessage[] {
    return (this.waiting.get(chatKey(agentId, personId)) ?? []).map(
      ({ id, text }) => ({ id, text }),
    );
  }

  /**
   * Takes a place among the limits for an answer that runs without a job,
   * such as one of the simulation (PAGE-304).
   *
   * @throws {AgentEmployeeError} `stopped` when the signal ends the wait.
   */
  public admit(
    agentId: string,
    request: AgentSessionSlotRequest,
  ): Promise<AgentSessionSlot> {
    return this.dependencies.slots
      ? this.dependencies.slots.acquire(agentId, request)
      : Promise.resolve(UNLIMITED_SLOT);
  }

  /** Stops the running job of one session of an agent; other sessions run on. */
  public async stopSession(agent: User, sessionId: string): Promise<void> {
    await this.dependencies.acp?.stop(agent, sessionId);
  }

  /**
   * Stops the running job of the person's conversation with an agent and the
   * messages that wait in its queue; other chats of the agent run on.
   */
  public async stop(person: User, agentId: unknown): Promise<void> {
    if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
      throw new AgentEmployeeError("invalidInput");
    for (const entry of this.waiting.get(chatKey(agentId, person.id)) ?? [])
      entry.controller.abort();
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

  /**
   * The messages of a conversation of the agent that joined its running job
   * and wait for their turn (PAGE-304): sent while the agent answered, not
   * yet taken into that answer.
   *
   * @returns Their message IDs; empty while no job runs.
   */
  public async waitingInJob(
    agent: User,
    sessionId: string,
  ): Promise<ReadonlySet<string>> {
    const acp = this.dependencies.acp;
    if (!acp) return new Set();
    const activity = await acp.activity(agent.id, sessionId);
    if (activity.job?.state !== "running") return new Set();
    return new Set(
      activity.steers
        .filter((steer) => WAITING_STEERS.has(steer.status))
        .map((steer) => steer.messageId),
    );
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
    const { agent } = request;
    const conversation = await this.dependencies.store.conversations().ensure(
      {
        agentId: agent.id,
        personId: request.conversationId ?? request.person?.id ?? agent.id,
        purpose: request.purpose,
      },
      this.dependencies.createSessionId(),
    );
    const chatRequest: PicaAcpRequest = {
      clientMessageId: request.clientMessageId,
      sessionId: conversation.sessionId,
      text: request.text,
      attachmentIds: [],
    };
    try {
      return await this.admitAndStart(acp, request, chatRequest);
    } catch (error: unknown) {
      throw this.translate(error);
    }
  }

  /**
   * Joins the running job of the chat, or takes a place and starts a job.
   *
   * @remarks
   * A message that waited for its place looks for a running job of its chat
   * again, since an earlier message may have started one meanwhile. A chat
   * whose previous job is still closing gets its next job once it is closed.
   */
  private async admitAndStart(
    acp: NonNullable<AgentEmployeeSessionDependencies["acp"]>,
    request: AgentJobRequest,
    chatRequest: PicaAcpRequest,
  ): Promise<{
    readonly start: ChatJobStart;
    readonly sessionId: string;
  } | null> {
    const { agent, employee } = request;
    const { sessionId } = chatRequest;
    const steered = async (): Promise<boolean> =>
      request.purpose === "chat" &&
      (await acp.steer(agent, chatRequest)) !== null;
    for (let attempt = 1; ; attempt += 1) {
      if (await steered()) {
        request.onAdmitted?.();
        return null;
      }
      const slot = await this.admit(agent.id, {
        signal: request.signal,
        onQueued: request.onQueued,
      });
      request.onAdmitted?.();
      try {
        if (slot.hasWaited && (await steered())) {
          slot.release();
          return null;
        }
        const assignment = await this.assignment(employee);
        const { brief, audience } = await this.brief(request, sessionId);
        const run = await this.employeeRun(agent, employee, {
          assignment,
          audience,
          keptSession: keptSessionOf(request),
        });
        const start = await acp.start({
          actor: agent,
          request: chatRequest,
          agent: assignment,
          brief,
          employee: {
            ...run,
            onSettled: () => {
              slot.release();
              this.recordAnswer(request, sessionId);
            },
          },
        });
        return { start, sessionId };
      } catch (error: unknown) {
        slot.release();
        if (!isSessionBusy(error) || attempt >= SESSION_BUSY_ATTEMPTS)
          throw error;
        await acp.settled(agent, sessionId);
      }
    }
  }

  private forgetWaiting(key: string, entry: WaitingMessage): void {
    const rest = (this.waiting.get(key) ?? []).filter(
      (candidate) => candidate !== entry,
    );
    if (rest.length === 0) this.waiting.delete(key);
    else this.waiting.set(key, rest);
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

  /**
   * The instruction and the context of a job (PAGE-305): a chat gets its
   * history after the summary, the summary, the topics of `MEMORY.md` and
   * the related archive entries the rules of sharing give it, and
   * `DREAM.md`; a run of the agent's own gets none of them.
   */
  private async brief(
    request: AgentJobRequest,
    sessionId: string,
  ): Promise<{
    readonly brief: PicaAcpStart["brief"];
    readonly audience: AgentMemoryAudience;
  }> {
    const { agent, employee, person } = request;
    const [identity, settings, context] = await Promise.all([
      this.identity(agent.id),
      person ? this.dependencies.languages.findByUserId(person.id) : null,
      this.context.forJob(request, { sessionId, message: request.text }),
    ]);
    return {
      audience: context.audience,
      brief: {
        instructions: createAgentEmployeeInstructions({
          name: agent.displayName,
          ...identity,
          soul: employee.soul,
          instructions: employee.instructions,
          memory: context.memory,
          dream: context.dream,
          related: context.related,
          access: employee.access,
          personName: context.isChat ? (person?.displayName ?? null) : null,
        }),
        // A continued agent session receives its history again (PAGE-305).
        keepsContext: true,
        prompt: {
          personName: person?.displayName ?? agent.displayName,
          interfaceLanguage: settings?.language ?? "de",
          today:
            this.dependencies.today?.() ??
            new Date().toISOString().slice(0, 10),
          // A run of the agent's own reads its sources from the message alone.
          history: context.history,
          summary: context.summary,
          nativeTools: true,
          assistantName: agent.displayName,
        },
      },
    };
  }

  /** The job title and the role of an agent, as its instruction names them. */
  private async identity(agentId: string): Promise<{
    readonly position: string | null;
    readonly roleName: string | null;
  }> {
    const [snapshot, titles] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.store.identities().jobTitles(),
    ]);
    const account = snapshot.accounts.find(
      (candidate) => candidate.userId === agentId,
    );
    return {
      position: titles.get(agentId) ?? null,
      roleName: account?.role?.name ?? null,
    };
  }

  /**
   * Hands the finished answer of a direct chat to the memory (PAGE-305):
   * the person's messages since the previous answer and the answer itself.
   */
  private recordAnswer(request: AgentJobRequest, sessionId: string): void {
    const { recorder } = this.dependencies;
    const { person } = request;
    if (!recorder || request.purpose !== "chat" || !person) return;
    void withBackgroundDatabaseWork("agent_memory_answer", async () => {
      const transcript = await this.dependencies.messages.messages(sessionId);
      const answer = transcript.at(-1);
      if (answer?.role !== "assistant") return;
      const previous = transcript
        .slice(0, -1)
        .findLastIndex((message) => message.role === "assistant");
      const message = transcript
        .slice(previous + 1, -1)
        .map((entry) => entry.content)
        .join("\n\n");
      await recorder.record({
        agent: request.agent,
        chat: { kind: "person", personId: person.id },
        chatLabel: `Chat mit ${person.displayName}`,
        personName: person.displayName,
        message,
        answer: answer.content,
        sessionId,
      });
    }).catch((error: unknown) => {
      logCaughtError("AgentEmployeeSessions", error);
    });
  }

  /**
   * The runner of a job with the agent's access level (PAGE-303): the host's
   * MCP servers, read anew for every job, and the file tools only with host
   * tools.
   */
  private async employeeRun(
    agent: User,
    employee: StoredAgentEmployee,
    job: {
      readonly assignment: ResolvedAgentAssignment;
      /** The chat whose rules of sharing `memory_search` applies (PAGE-305). */
      readonly audience: AgentMemoryAudience;
      readonly keptSession: PicaAcpEmployeeRun["keptSession"];
    },
  ): Promise<NonNullable<PicaAcpStart["employee"]>> {
    const { assignment, audience, keptSession } = job;
    const { access } = employee;
    const hostServers =
      (await this.dependencies.accessEnvironment?.chatServers(
        assignment.connection.provider,
        access,
      )) ?? [];
    const { hostFiles } = this.dependencies;
    const agentChat = this.dependencies.agentChat?.() ?? null;
    return {
      ...(agentChat ? { agentChat } : {}),
      ...(keptSession ? { keptSession } : {}),
      runner: employeeAcpRunner(assignment, access, hostServers),
      hasBrowser: hasHostTools(access),
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
        entries: await this.dependencies.memory.search(
          agent.id,
          query,
          audience,
        ),
      }),
      ...this.contextReading(agent.id),
    };
  }

  /** The reading of group contexts, bound to the agent's own account. */
  private contextReading(
    agentId: string,
  ): Pick<NonNullable<PicaAcpStart["employee"]>, "readConversationContext"> {
    const reader = this.dependencies.conversationContext;
    if (!reader) return {};
    return {
      readConversationContext: (input) => reader.readForAgent(agentId, input),
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

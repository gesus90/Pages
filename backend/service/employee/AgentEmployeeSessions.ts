import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";

import { AgentChatActivity } from "./AgentChatActivity";
import { AgentChatContext } from "./AgentChatContext";
import {
  buildEmployeeBrief,
  buildEmployeeRun,
  recordEmployeeAnswer,
} from "./AgentEmployeeSessionLaunch";
import { chatScopeOf } from "./AgentEmployeeJobRun";
import { foldJobToolCalls } from "./AgentToolCallView";

import type { LiveAnswerSink } from "@/backend/service/conversation/ConversationLiveAnswer";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type { PicaAcpRequest } from "../chat/acp/PicaAcpService";
import type {
  ChatJob,
  ChatJobStart,
  ChatSteerStatus,
} from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type {
  PicaAcpEmployeeRun,
  PicaAcpStart,
} from "../chat/acp/PicaAcpService";
import type { AgentChatScope } from "./AgentEmployeeSessionTypes";
import type { AgentChatToolScope } from "./AgentChatToolGuard";
import type { AgentMemoryAudience } from "./AgentMemorySharing";
import type { AgentToolCallView } from "./AgentToolCallView";
import type {
  AgentSessionSlot,
  AgentSessionSlotRequest,
} from "./AgentSessionSlots";

import {
  IDENTIFIER,
  chatKey,
  chatModelKey,
  isChatPurpose,
  isSessionBusy,
  keptSessionOf,
  type AgentEmployeeSessionDependencies,
  type AgentJobRequest,
  type QueuedAgentMessage,
  type WaitingMessage,
  readMessage,
} from "./AgentEmployeeSessionTypes";
export type {
  AgentEmployeeSessionDependencies,
  AgentJobRequest,
  QueuedAgentMessage,
} from "./AgentEmployeeSessionTypes";
import { employeeAssignment } from "./AgentEmployeeAssignments";

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

/** Steers that joined the running turn or went to the adapter for it (PAGE-381). */
const INJECTED_STEERS: ReadonlySet<ChatSteerStatus> = new Set([
  "delivered",
  "accepted",
]);

/** The place of a session without limits, for a server without them. */
const UNLIMITED_SLOT: AgentSessionSlot = {
  hasWaited: false,
  release: () => undefined,
};

/**
 * Sessions of agent employees over ACP (PAGE-266).
 *
 * @remarks
 * A session runs on Pica's ACP path, but as the agent's own account: its
 * conversation belongs to the agent, so every tool call is checked against
 * the agent's role, departments and project memberships. It runs with the
 * model and access stored for the agent; full access only inside the
 * isolation the ACP execution never runs YOLO without. `SOUL.md` and
 * `AGENT.md` open every instruction, `MEMORY.md` follows as data. Settings
 * apply to the next round; a running round keeps its configuration while
 * every turn and tool call still checks that the account is active.
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
  /** The rounds the agents answer in chats now (PAGE-376). */
  private readonly activity = new AgentChatActivity();

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
        isDeferred: message.delivery === "after",
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
   * Cancels the running tool call of a chat of the agent, such as its answer
   * in a group (PAGE-381); the agent answers with what it has.
   *
   * @returns Whether a running call was cancelled.
   */
  public async cancelChatTool(
    agent: User,
    target: {
      readonly purpose: "chat" | "conversation";
      readonly personId?: string;
      readonly conversationId?: string;
    },
  ): Promise<boolean> {
    const acp = this.dependencies.acp;
    if (!acp) return false;
    const conversation = await this.dependencies.store
      .conversations()
      .find(
        agent.id,
        target.conversationId ?? target.personId ?? agent.id,
        target.purpose,
      );
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

  /**
   * The messages of a conversation of the agent its running job took into
   * its answer (PAGE-381): joined its turn or handed to the adapter for it.
   *
   * @returns Their message IDs; empty while no job runs.
   */
  public async injectedInJob(
    agent: User,
    sessionId: string,
  ): Promise<ReadonlySet<string>> {
    const acp = this.dependencies.acp;
    if (!acp) return new Set();
    const activity = await acp.activity(agent.id, sessionId);
    if (activity.job?.state !== "running") return new Set();
    return new Set(
      activity.steers
        .filter((steer) => INJECTED_STEERS.has(steer.status))
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
   * Hands a message to the running job of a chat of the agent (PAGE-376).
   *
   * @param agent - The agent whose job runs.
   * @param target - The chat: the direct chat with a person or a conversation.
   * @param text - The message as the agent reads it.
   * @returns Whether the running job took it; `false` when none runs, so the
   * message waits for its own turn.
   */
  public async steerChat(
    agent: User,
    target: {
      readonly purpose: "chat" | "conversation";
      readonly personId?: string;
      readonly conversationId?: string;
    },
    text: string,
  ): Promise<boolean> {
    const acp = this.dependencies.acp;
    if (!acp) return false;
    const conversation = await this.dependencies.store
      .conversations()
      .find(
        agent.id,
        target.conversationId ?? target.personId ?? agent.id,
        target.purpose,
      );
    if (!conversation) return false;
    const steer = await acp.steer(agent, {
      clientMessageId: null,
      sessionId: conversation.sessionId,
      text,
      attachmentIds: [],
    });
    return steer !== null;
  }

  /** Whether the agent works in a chat now: a round runs or one waits for a place. */
  public isWorkingInChat(agentId: string): boolean {
    if (this.activity.isWorking(agentId)) return true;
    return [...this.waiting.keys()].some((key) =>
      key.startsWith(`${agentId}:`),
    );
  }

  /**
   * Waits until the agent works in no chat, for its background runs (PAGE-376).
   *
   * @returns Whether the agent is free; `false` after the longest wait.
   */
  public whenOutOfChats(agentId: string): Promise<boolean> {
    return this.activity.whenIdle({
      isBusy: () => this.isWorkingInChat(agentId),
      ...(this.dependencies.wait ? { wait: this.dependencies.wait } : {}),
    });
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
      ...(request.isDeferred === true ? { isDeferred: true } : {}),
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
      request.isScheduled !== true &&
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
      const endRound = this.beginRound(request);
      try {
        if (slot.hasWaited && (await steered())) {
          endRound();
          slot.release();
          return null;
        }
        await this.restartIfNeeded(request, sessionId);
        const assignment = await this.assignment(
          employee,
          request.modelOverride ?? (await this.chatModel(request)),
        );
        const { brief, audience, logbookNewest } = await this.brief(
          request,
          sessionId,
        );
        const run = await this.employeeRun(agent, employee, {
          assignment,
          audience,
          keptSession: keptSessionOf(request),
          chat: chatScopeOf(request, sessionId),
          connectionId: assignment.connection.id,
        });
        const start = await acp.start({
          actor: agent,
          request: chatRequest,
          agent: assignment,
          brief,
          employee: {
            ...run,
            ...this.liveAnswerOf(request),
            prepareTurn: request.prepareTurn,
            consumeAnswer: request.consumeAnswer,
            onSettled: () => {
              endRound();
              slot.release();
              recordEmployeeAnswer(this.dependencies, request, sessionId);
              this.afterRound(request, sessionId);
            },
          },
        });
        await this.markLogbookSeen(sessionId, logbookNewest);
        return { start, sessionId };
      } catch (error: unknown) {
        endRound();
        slot.release();
        if (!isSessionBusy(error) || attempt >= SESSION_BUSY_ATTEMPTS)
          throw error;
        await acp.settled(agent, sessionId);
      }
    }
  }

  /**
   * The live answer of a round for the chat page (PAGE-381): the one the
   * caller opened, such as a group's, or one of its own for the direct chat
   * with a person, whose thoughts only that person reads. A run of the
   * agent's own shows none.
   */
  private liveAnswerOf(
    request: AgentJobRequest,
  ): { readonly liveAnswer: LiveAnswerSink } | Record<string, never> {
    if (request.liveAnswer) return { liveAnswer: request.liveAnswer };
    const { answers } = this.dependencies;
    const { person, agent } = request;
    if (!answers || request.purpose !== "chat" || !person) return {};
    return {
      liveAnswer: answers.open({
        agentId: agent.id,
        chatKind: "agent",
        chatId: agent.id,
        recipientIds: [person.id],
        thoughtRecipientIds: [person.id],
        isTurnStored: true,
      }),
    };
  }

  /** Tells the session the entries of the Lagebuch its round just carried the hint line for (PAGE-377). */
  private async markLogbookSeen(
    sessionId: string,
    newest: number,
  ): Promise<void> {
    const logbook = this.dependencies.logbook?.();
    if (!logbook || newest <= 0) return;
    try {
      await logbook.markSeen(sessionId, newest);
    } catch (error: unknown) {
      // The hint is a courtesy: a failed note must not fail the round.
      logCaughtError("AgentEmployeeSessions", error);
    }
  }

  /** Notes a round of a chat of the agent; a run of the agent's own is no chat round. */
  private beginRound(request: AgentJobRequest): () => void {
    return isChatPurpose(request.purpose)
      ? this.activity.begin(request.agent.id)
      : () => undefined;
  }

  /** Restarts a session that reached its context threshold before its next round (PAGE-376). */
  private async restartIfNeeded(
    request: AgentJobRequest,
    sessionId: string,
  ): Promise<void> {
    if (!isChatPurpose(request.purpose)) return;
    await this.dependencies
      .lifecycle?.()
      ?.restartIfNeeded(request.agent, sessionId);
  }

  /** Records what the finished round used and restarts the session at a full context (PAGE-376). */
  private afterRound(request: AgentJobRequest, sessionId: string): void {
    const lifecycle = this.dependencies.lifecycle?.();
    if (!lifecycle || !isChatPurpose(request.purpose)) return;
    void withBackgroundDatabaseWork("agent_chat_round", () =>
      lifecycle.afterRound(request.agent, sessionId),
    ).catch((error: unknown) => {
      logCaughtError("AgentEmployeeSessions", error);
    });
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

  /**
   * The model chosen for the agent in the chat of a round (PAGE-380); a run of
   * the agent's own and a chat without a choice answer with its own model.
   */
  private async chatModel(
    request: AgentJobRequest,
  ): Promise<AgentJobRequest["modelOverride"]> {
    const key = chatModelKey(request);
    if (key === null) return undefined;
    let stored: Awaited<
      ReturnType<ReturnType<EmployeeStore["chatModels"]>["find"]>
    >;
    try {
      stored = await this.dependencies.store.chatModels().find(key);
    } catch (error: unknown) {
      // A failed read must not fail the round: the agent answers with its own model.
      logCaughtError("AgentEmployeeSessions", error);
      return undefined;
    }
    return stored
      ? {
          connectionId: stored.connectionId,
          model: stored.model,
          reasoningEffort: stored.reasoningEffort,
        }
      : undefined;
  }

  private assignment(
    employee: StoredAgentEmployee,
    override?: AgentJobRequest["modelOverride"],
  ): Promise<ResolvedAgentAssignment> {
    return employeeAssignment(this.dependencies.models, employee, override);
  }

  private brief(
    request: AgentJobRequest,
    sessionId: string,
  ): Promise<{
    readonly brief: PicaAcpStart["brief"];
    readonly audience: AgentMemoryAudience;
    /** The newest entry of the Lagebuch the round's hint line covers (PAGE-377). */
    readonly logbookNewest: number;
  }> {
    return buildEmployeeBrief(
      this.dependencies,
      this.context,
      request,
      sessionId,
    );
  }

  /**
   * Hands the finished answer of a direct chat to the memory (PAGE-305):
   * the person's messages since the previous answer and the answer itself.
   */
  private recordAnswer(request: AgentJobRequest, sessionId: string): void {
    recordEmployeeAnswer(this.dependencies, request, sessionId);
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
      /** The chat the job runs in (PAGE-376). */
      readonly chat: AgentChatScope;
      /** The connection the job runs on, which stays the only one it may use. */
      readonly connectionId: string;
    },
  ): Promise<NonNullable<PicaAcpStart["employee"]>> {
    return buildEmployeeRun(
      this.dependencies,
      () => this.requireCurrent(agent.id),
      { agent, employee },
      job,
    );
  }

  /**
   * Checks a running job against the current state of its agent: still
   * active and present; configuration changes apply to the next round.
   */
  private async requireCurrent(agentId: string): Promise<void> {
    const [agent, employee] = await Promise.all([
      this.dependencies.users.findById(agentId),
      this.dependencies.store.employees().find(agentId),
    ]);
    if (!agent?.isActive || agent.isAgent !== true || !employee)
      throw new ChatError("accessDenied");
    // Configuration is pinned for this turn; the next round reads the new settings.
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

import { randomUUID } from "node:crypto";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { isChatJobId } from "@/definition/ChatJob";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { readChatSessionId } from "../ChatSessionService";
import { PicaAcpJob } from "./PicaAcpJob";
import { PicaAcpSessionGates } from "./PicaAcpSessionGates";
import { picaAcpRunner } from "./PicaAcpRunners";

import type { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import type {
  ChatRequestAdmission,
  ChatRequestRegistry,
} from "@/backend/service/chat/ChatRequestRegistry";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentChatTools } from "@/definition/AgentChat";
import type { ChatSendResult } from "@/definition/Chat";
import type {
  ChatJob,
  ChatJobEntry,
  ChatJobStart,
  ChatJobUpdate,
  ChatSessionActivity,
  ChatSteer,
} from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type { ChatAttachmentService } from "../ChatAttachmentService";
import type { PicaAcpJobDependencies, PicaAcpRun } from "./PicaAcpJob";
import type { PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpMessage } from "./PicaAcpSteering";
import type { PicaAcpRunner } from "./PicaAcpRunners";
import type { AgentHostFileTarget } from "@/backend/service/employee/AgentHostFiles";
import type { PicaAcpWorkspace } from "./PicaAcpWorkspace";
import type { PicaAcpSessionPool } from "./PicaAcpSessionPool";
import type { PicaAcpJobPool } from "./PicaAcpPoolOpening";

/** A job of a conversation with its journal (PAGE-303). */
export interface ChatJobJournal {
  readonly job: ChatJob;
  readonly events: readonly ChatJobEntry[];
}

/** Journal entries one read returns at most. */
const PAGE_ENTRIES = 200;

/** What the ACP path of Pica is built from. */
export interface PicaAcpServiceDependencies extends PicaAcpJobDependencies {
  readonly admit?: <Result>(work: () => Promise<Result>) => Promise<Result>;
  readonly jobs: ChatJobRepository;
  readonly steers: ChatSteerRepository;
  readonly acpSessions: ChatAcpSessionRepository;
  readonly attachments: Pick<
    ChatAttachmentService,
    "pending" | "link" | "readText" | "readBytes"
  >;
  /** The registry of running chat answers: one per person, its deadline and the shutdown. */
  readonly requests: ChatRequestRegistry;
  readonly workspace: PicaAcpWorkspace;
  readonly requireCurrent?: (
    userId: string,
    assignment: ResolvedAgentAssignment,
  ) => Promise<void>;
  /** The chat sessions agent employees keep between rounds (PAGE-335); absent opens one per job. */
  readonly pool?: Pick<PicaAcpSessionPool, "open" | "close">;
}

/** A sent message after validation. */
export interface PicaAcpRequest {
  /** The ID the browser gave the message; a message is stored once per ID. */
  readonly clientMessageId: string | null;
  readonly sessionId: string;
  readonly text: string;
  readonly attachmentIds: unknown;
}

/**
 * How a job of an agent employee differs from one of Pica (PAGE-266).
 *
 * @remarks
 * The job runs as the agent's own account, with the runner of its stored
 * access. Its configuration, not Pica's settings, is checked again before
 * every turn and tool call, and Pica's switch does not admit it.
 */
export interface PicaAcpEmployeeRun {
  readonly runner: PicaAcpRunner;
  /** Browser access derived from the stored employee level, never model input. */
  readonly hasBrowser?: boolean;
  /** Fails when the agent was deactivated, changed or reached its cost limit. */
  readonly requireCurrent: () => Promise<void>;
  /** Fails when the connection of the job is no longer the agent's. */
  readonly requireConnection: (connectionId: string) => Promise<void>;
  /** Searches the agent's own memory archive. */
  readonly searchMemory: (query: string) => Promise<unknown>;
  /** Reads a group of the agent's own account (PAGE-296). */
  readonly readConversationContext?: (input: unknown) => Promise<unknown>;
  /**
   * Attaches a file of the job's working folder to a ticket or a wiki page
   * with the agent's rights; present only with host tools (PAGE-303).
   */
  readonly attachFile?: (
    directory: string,
    target: AgentHostFileTarget,
    file: string,
  ) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  /**
   * Called once when the job ended, however it ended, so the caller frees
   * the place of the session among the limits of the agent (PAGE-304).
   */
  readonly onSettled?: () => void;
  /** The Pages tools to read chats and send messages (PAGE-311); absent where none run. */
  readonly agentChat?: AgentChatTools;
  /**
   * Keeps the session of the chat for the next round (PAGE-335): the label of
   * the conversation for the resource view and the revision of the agent,
   * whose change starts a new session. Absent opens a session per job.
   */
  readonly keptSession?: {
    readonly conversation: string;
    readonly revision: number;
  };
}

/** What a new job is started from; the agent is resolved by the caller for this message. */
export interface PicaAcpStart {
  readonly actor: User;
  readonly request: PicaAcpRequest;
  readonly agent: ResolvedAgentAssignment;
  /** Instructions and context with the transcript; a continued session leaves the transcript out. */
  readonly brief: PicaTurnBrief;
  /** Present for a job of an agent employee instead of Pica. */
  readonly employee?: PicaAcpEmployeeRun;
}

interface RunningJob {
  readonly job: PicaAcpJob;
  /** Settles after the request registry released the job. */
  readonly completion: Promise<void>;
}

type SteerDecision =
  | { readonly kind: "none" }
  | { readonly kind: "wait"; readonly completion: Promise<void> }
  | { readonly kind: "steered"; readonly steer: ChatSteer };

function readCursor(input: unknown): number {
  if (input === undefined || input === null) return 0;
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0)
    throw new ChatError("invalidInput");
  return input;
}

/**
 * Pica over ACP: jobs that run without the browser, steering and their
 * journal, with Codex CLI, Claude Code or native OpenCode (PAGE-91).
 *
 * @remarks
 * Every conversation has one queue; a sent message passes it and either joins
 * the running job or starts the next one, never both. A job keeps the agent
 * that was resolved for its first message; the next job resolves anew, so a
 * changed assignment applies from the next message on. Jobs run in the
 * existing chat registry with its deadline and shutdown: one per person for
 * Pica, one per conversation for an agent employee, whose conversations run
 * side by side (PAGE-304). A conversation that rests gives its queue up
 * after an idle time. Every read and stop is bound to the owner of the
 * conversation.
 */
export class PicaAcpService {
  private readonly dependencies: PicaAcpServiceDependencies;
  private readonly running = new Map<string, RunningJob>();
  private readonly gates = new PicaAcpSessionGates();
  /** Conversations being deleted; no job starts or takes a message for them. */
  private readonly deleting = new Set<string>();
  private recovery: Promise<void> | null = null;
  private agentDeletions: PicaAcpServiceDependencies["agentDeletions"];

  public constructor(dependencies: PicaAcpServiceDependencies) {
    this.dependencies = dependencies;
    this.agentDeletions = dependencies.agentDeletions;
  }

  /** Offers the shared deletion service to new Pica turns after service wiring. */
  public setAgentDeletions(
    service: NonNullable<PicaAcpServiceDependencies["agentDeletions"]>,
  ): void {
    this.agentDeletions = service;
  }

  /**
   * Sends a message into the running job of the conversation.
   *
   * @returns The stored steer, or `null` when no job runs; a closing job is awaited first.
   */
  public async steer(
    actor: User,
    request: PicaAcpRequest,
  ): Promise<ChatSteer | null> {
    await this.ready();
    const session = await this.dependencies.sessions.require(
      actor,
      request.sessionId,
    );
    for (;;) {
      const decision = await this.gate(session.id, () =>
        this.decide(actor, session.id, request),
      );
      if (decision.kind === "steered") return decision.steer;
      if (decision.kind === "none") return null;
      // The job no longer takes messages; the next one starts once it released its lease.
      await decision.completion;
    }
  }

  /**
   * Stores the message and starts its job, which runs on without the browser.
   *
   * @throws {AgentExecutionError} `requestBusy` while another answer of the person runs.
   * @throws {ChatError} `acpProviderUnsupported` for an unsupported ACP
   * connection, `acpPermissionModeUnsupported` for
   * a mode the runner does not run Pica in; both before anything is stored.
   */
  public async start(input: PicaAcpStart): Promise<ChatJobStart> {
    await this.ready();
    const runner = input.employee?.runner ?? picaAcpRunner(input.agent);
    const run: PicaAcpRun = { runner, options: runner.runOptions(input.agent) };
    const session = await this.dependencies.sessions.require(
      input.actor,
      input.request.sessionId,
    );
    const launch = (): Promise<ChatJobStart> =>
      this.gate(session.id, () => this.launch(input, session.id, run));
    // Pica's switch admits Pica's jobs only; an agent employee has its own state.
    return this.dependencies.admit && !input.employee
      ? this.dependencies.admit(launch)
      : launch();
  }

  /**
   * Reads a job of an own conversation with its journal after a cursor.
   *
   * @param actor - The signed-in person.
   * @param input - `sessionId`, optionally `jobId`, and `after`, the last sequence read.
   * @returns The update, or `null` when the conversation has no such job.
   */
  public async update(
    actor: User,
    input: unknown,
  ): Promise<ChatJobUpdate | null> {
    await this.ready();
    const fields = readAgentObject(input);
    const sessionId = readChatSessionId(fields.sessionId);
    await this.dependencies.sessions.require(actor, sessionId);
    const after = readCursor(fields.after);
    const { jobs } = this.dependencies;
    const job = isChatJobId(fields.jobId)
      ? await jobs.find(actor.id, fields.jobId)
      : await jobs.latest(actor.id, sessionId);
    if (job === null || job.sessionId !== sessionId) return null;
    const page = await jobs.events(actor.id, job.id, {
      after,
      limit: PAGE_ENTRIES + 1,
    });
    const events = page.slice(0, PAGE_ENTRIES);
    return {
      job,
      events,
      cursor: events.at(-1)?.sequence ?? after,
      hasMore: page.length > PAGE_ENTRIES,
    };
  }

  /**
   * Reads the journals of the newest jobs of an own conversation, for the
   * tool calls the chat page shows under each answer (PAGE-303).
   *
   * @param actor - The account the conversation belongs to.
   * @param sessionId - The conversation.
   * @param limits - How many jobs, and journal entries per job, at most.
   * @returns The jobs, oldest first, each with its journal.
   */
  public async journals(
    actor: User,
    sessionId: unknown,
    limits: { readonly jobs: number; readonly entries: number },
  ): Promise<readonly ChatJobJournal[]> {
    await this.ready();
    const id = readChatSessionId(sessionId);
    await this.dependencies.sessions.require(actor, id);
    const { jobs } = this.dependencies;
    const recent = await jobs.recent(actor.id, id, limits.jobs);
    const journals: ChatJobJournal[] = [];
    for (const job of [...recent].reverse())
      journals.push({
        job,
        events: await jobs.events(actor.id, job.id, {
          after: 0,
          limit: limits.entries,
        }),
      });
    return journals;
  }

  /**
   * Waits until the job of an own conversation released its place, for a
   * start that found the conversation still busy (PAGE-304).
   */
  public async settled(actor: User, sessionId: unknown): Promise<void> {
    const id = readChatSessionId(sessionId);
    const entry = this.running.get(id);
    if (entry?.job.userId === actor.id) await entry.completion;
  }

  /** Stops the running job of an own conversation on the person's explicit request. */
  public async stop(actor: User, sessionId: unknown): Promise<void> {
    const id = readChatSessionId(sessionId);
    await this.dependencies.sessions.require(actor, id);
    this.cancel(actor.id, id);
  }

  /**
   * Cancels the running tool call of the running job of an own conversation
   * on the person's request; the job goes on (PAGE-303).
   *
   * @returns Whether a running call was cancelled.
   */
  public async cancelTool(actor: User, sessionId: unknown): Promise<boolean> {
    const id = readChatSessionId(sessionId);
    await this.dependencies.sessions.require(actor, id);
    const entry = this.running.get(id);
    if (entry?.job.userId !== actor.id) return false;
    return entry.job.cancelTool();
  }

  /**
   * What a stored message of an own conversation became on this path, for a
   * message the browser sends again because it lost the first answer.
   *
   * @returns The job the message started or the steer it joined, or `null` for
   * a message that took neither path, such as one an API agent answered.
   */
  public async outcome(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<ChatSendResult | null> {
    await this.ready();
    const job = await this.dependencies.jobs.findByMessage(userId, messageId);
    if (job !== null) return { kind: "job", job: { job, messageId } };
    const steers = await this.dependencies.steers.list(sessionId);
    const steer = steers.find((entry) => entry.messageId === messageId);
    return steer ? { kind: "steer", steer } : null;
  }

  /** The newest job, the steers and the selection snapshots of an own conversation. */
  public async activity(
    userId: string,
    sessionId: string,
  ): Promise<ChatSessionActivity> {
    await this.ready();
    const [job, steers, selections] = await Promise.all([
      this.dependencies.jobs.latest(userId, sessionId),
      this.dependencies.steers.list(sessionId),
      this.dependencies.steers.selections(sessionId),
    ]);
    return { job, steers, selections };
  }

  /**
   * Before a conversation is deleted: takes no further message for it, stops
   * its job and waits until its process is gone.
   */
  public async forget(userId: string, sessionId: string): Promise<void> {
    await this.gate(sessionId, () => {
      this.deleting.add(sessionId);
      return Promise.resolve();
    });
    const entry = this.running.get(sessionId);
    if (entry?.job.userId === userId) {
      this.cancel(userId, sessionId);
      await entry.completion;
    }
    // The kept session of an agent works in the folder the deletion removes.
    await this.dependencies.pool?.close(sessionId);
  }

  /** Stops only Pica jobs at the existing cancellation boundary, retaining all chats. */
  public async stopAll(): Promise<void> {
    const pending = [...this.running.entries()];
    for (const [sessionId, entry] of pending)
      this.cancel(entry.job.userId, sessionId);
    await Promise.allSettled(pending.map(([, entry]) => entry.completion));
  }

  /**
   * After the deletion of a conversation, successful or not: removes its empty
   * working directory and takes messages again; a failure is only logged.
   */
  public async cleanup(sessionId: string): Promise<void> {
    try {
      await this.dependencies.workspace.remove(sessionId);
    } catch (error: unknown) {
      logCaughtError("PicaAcpService", error);

      logDiagnostic(
        "PicaAcpService",
        "error",
        "[pages] A Pica working directory could not be removed.",
        error,
      );
    } finally {
      this.deleting.delete(sessionId);
      if (!this.running.has(sessionId)) this.gates.release(sessionId);
    }
  }

  private cancel(userId: string, sessionId: string): void {
    const entry = this.running.get(sessionId);
    if (entry?.job.userId !== userId) return;
    entry.job.stop();
    this.dependencies.requests.cancel(userId, entry.job.id);
  }

  private async decide(
    actor: User,
    sessionId: string,
    request: PicaAcpRequest,
  ): Promise<SteerDecision> {
    const entry = this.running.get(sessionId);
    if (this.deleting.has(sessionId) || entry?.job.userId !== actor.id)
      return { kind: "none" };
    if (!entry.job.isAccepting())
      return { kind: "wait", completion: entry.completion };
    const message = await this.store(actor, sessionId, request);
    await this.dependencies.steers.create(
      { messageId: message.id, jobId: entry.job.id },
      sessionId,
    );
    const status = await entry.job.steer(message);
    if (status === null)
      await this.dependencies.steers.update(message.id, "failed");
    return {
      kind: "steered",
      steer: {
        messageId: message.id,
        jobId: entry.job.id,
        status: status ?? "failed",
      },
    };
  }

  private async launch(
    input: PicaAcpStart,
    sessionId: string,
    run: PicaAcpRun,
  ): Promise<ChatJobStart> {
    const { actor, agent } = input;
    const dependencies = this.jobDependencies(input.employee);
    await dependencies.requireCurrent?.(actor.id, agent);
    if (this.deleting.has(sessionId)) throw new ChatError("sessionMissing");
    if (this.running.has(sessionId))
      throw new AgentExecutionError("requestBusy");
    const id = randomUUID();
    // Refused before anything is stored, as the API path refuses a second answer.
    const admission: ChatRequestAdmission = input.employee
      ? "session"
      : "person";
    this.dependencies.requests.requireAdmission(actor.id, id, admission);
    const directory = await this.dependencies.workspace.prepare(sessionId);
    const resumeSessionId = await this.compatibleSession(actor.id, sessionId, {
      agent,
      profile: run.runner.profile,
    });
    const message = await this.store(actor, sessionId, input.request);
    await this.dependencies.jobs.create({
      id,
      sessionId,
      userId: actor.id,
      messageId: message.id,
    });
    const attachFile = input.employee?.attachFile;
    const job = new PicaAcpJob(
      attachFile
        ? {
            ...dependencies,
            attachHostFile: (target, file) =>
              attachFile(directory, target, file),
          }
        : dependencies,
      {
        id,
        actor,
        sessionId,
        agent,
        run,
        directory,
        message,
        brief: input.brief,
        resumeSessionId,
        gate: (task) => this.gate(sessionId, task),
        pool: this.keptSession(input, { sessionId, run, directory }),
      },
    );
    this.register(sessionId, job, {
      admission,
      onSettled: input.employee?.onSettled,
    });
    const started = await this.dependencies.jobs.find(actor.id, id);
    if (started === null) throw new ChatError("sessionMissing");
    return { job: started, messageId: message.id };
  }

  /**
   * The kept chat session of an agent employee's job (PAGE-335).
   *
   * @remarks
   * Every value that shapes the native session is part of its fingerprint, so
   * a changed connection, model, effort, access, folder or agent starts a new
   * one instead of continuing the resting one.
   */
  private keptSession(
    input: PicaAcpStart,
    job: {
      readonly sessionId: string;
      readonly run: PicaAcpRun;
      readonly directory: string;
    },
  ): PicaAcpJobPool | undefined {
    const kept = input.employee?.keptSession;
    const { pool } = this.dependencies;
    if (!kept || !pool) return undefined;
    const { agent, actor } = input;
    return {
      sessions: pool,
      session: {
        chatSessionId: job.sessionId,
        agentId: actor.id,
        agentName: actor.displayName,
        conversation: kept.conversation,
        fingerprint: JSON.stringify([
          agent.connection.id,
          agent.model,
          agent.reasoningEffort,
          job.run.runner.profile,
          job.run.options,
          job.directory,
          kept.revision,
        ]),
      },
    };
  }

  /** The dependencies of a job: Pica's, or those bound to the configuration of an agent employee. */
  private jobDependencies(
    employee: PicaAcpEmployeeRun | undefined,
  ): PicaAcpServiceDependencies {
    if (!employee)
      return {
        ...this.dependencies,
        agentBrowsers: undefined,
        agentDeletions: this.agentDeletions,
      };
    return {
      ...this.dependencies,
      agentDeletions: undefined,
      agentBrowsers: employee.hasBrowser
        ? this.dependencies.agentBrowsers
        : undefined,
      requireCurrent: () => employee.requireCurrent(),
      searchMemory: (query) => employee.searchMemory(query),
      ...(employee.readConversationContext
        ? { readConversationContext: employee.readConversationContext }
        : {}),
      ...(employee.agentChat ? { agentChat: employee.agentChat } : {}),
      access: {
        requireUser: (userId, connectionId) =>
          employee.requireConnection(connectionId),
      },
    };
  }

  private register(
    sessionId: string,
    job: PicaAcpJob,
    options: {
      readonly admission: ChatRequestAdmission;
      readonly onSettled: (() => void) | undefined;
    },
  ): void {
    let completed: Promise<void>;
    try {
      completed = this.dependencies.requests.start(
        job.userId,
        job.id,
        (signal) => job.run(signal),
        options.admission,
      );
    } catch (error: unknown) {
      logCaughtError("PicaAcpService", error);

      // Another answer of the person started meanwhile; the job ends visibly, with its journal.
      void this.refuse(job.id).catch((caughtError: unknown) => {
        logCaughtError("PicaAcpService", caughtError);
        return undefined;
      });
      throw error;
    }
    const completion = completed
      .catch((caughtError: unknown) => {
        logCaughtError("PicaAcpService", caughtError);

        // The job recorded its own end; the registry reports only the cancellation.
      })
      .finally(() => {
        if (this.running.get(sessionId)?.job === job)
          this.running.delete(sessionId);
        options.onSettled?.();
      });
    this.running.set(sessionId, { job, completion });
  }

  private async refuse(id: string): Promise<void> {
    await this.dependencies.jobs.append(id, 1, {
      kind: "end",
      state: "failed",
      errorCode: "requestBusy",
    });
    await this.dependencies.jobs.finish(id, "failed", "requestBusy");
  }

  /** Stores a message with exactly its selected, unsent attachments. */
  private async store(
    actor: User,
    sessionId: string,
    request: PicaAcpRequest,
  ): Promise<PicaAcpMessage> {
    const { attachments, messages } = this.dependencies;
    const sent = await attachments.pending(sessionId, request.attachmentIds);
    const message = await messages.append(actor.id, sessionId, {
      role: "user",
      content: request.text,
      clientMessageId: request.clientMessageId,
    });
    await attachments.link(sessionId, message.id, sent);
    return { id: message.id, text: request.text, attachments: sent };
  }

  /**
   * The agent session to continue: same connection, model, effort and profile,
   * and no message reached the conversation on another path since.
   */
  private async compatibleSession(
    userId: string,
    sessionId: string,
    expected: {
      readonly agent: ResolvedAgentAssignment;
      readonly profile: string;
    },
  ): Promise<string | null> {
    const { agent, profile } = expected;
    const stored = await this.dependencies.acpSessions.find(userId, sessionId);
    if (
      stored === null ||
      stored.connectionId !== agent.connection.id ||
      stored.model !== agent.model ||
      stored.reasoningEffort !== agent.reasoningEffort ||
      stored.profile !== profile
    )
      return null;
    const messages = await this.dependencies.messages.messages(sessionId);
    return messages.at(-1)?.id === stored.throughMessageId
      ? stored.acpSessionId
      : null;
  }

  private gate<Result>(
    sessionId: string,
    task: () => Promise<Result>,
  ): Promise<Result> {
    return this.gates.run(sessionId, task, (id) => this.running.has(id));
  }

  /** Ends the jobs a previous server process left running, once, before the first use. */
  private ready(): Promise<void> {
    this.recovery ??= this.dependencies.jobs.interruptRunning().then(
      () => undefined,
      (error: unknown) => {
        this.recovery = null;
        throw error;
      },
    );
    return this.recovery;
  }
}

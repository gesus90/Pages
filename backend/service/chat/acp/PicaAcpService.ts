import { randomUUID } from "node:crypto";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { ChatError } from "@/backend/error/ChatErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { isChatJobId } from "@/definition/ChatJob";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { readChatSessionId } from "../ChatSessionService";
import { PicaAcpJob } from "./PicaAcpJob";
import { picaAcpRunner } from "./PicaAcpRunners";

import type { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import type { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { ChatSendResult } from "@/definition/Chat";
import type {
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
import type { PicaAcpWorkspace } from "./PicaAcpWorkspace";

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
}

/** A sent message after validation. */
export interface PicaAcpRequest {
  /** The ID the browser gave the message; a message is stored once per ID. */
  readonly clientMessageId: string | null;
  readonly sessionId: string;
  readonly text: string;
  readonly attachmentIds: unknown;
}

/** What a new job is started from; the agent is resolved by the caller for this message. */
export interface PicaAcpStart {
  readonly actor: User;
  readonly request: PicaAcpRequest;
  readonly agent: ResolvedAgentAssignment;
  /** Instructions and context with the transcript; a continued session leaves the transcript out. */
  readonly brief: PicaTurnBrief;
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
 * existing chat registry: one per person, the existing deadline and the
 * shutdown. Every read and stop is bound to the owner of the conversation.
 */
export class PicaAcpService {
  private readonly dependencies: PicaAcpServiceDependencies;
  private readonly running = new Map<string, RunningJob>();
  private readonly queues = new Map<string, SerialQueue>();
  /** Conversations being deleted; no job starts or takes a message for them. */
  private readonly deleting = new Set<string>();
  private recovery: Promise<void> | null = null;

  public constructor(dependencies: PicaAcpServiceDependencies) {
    this.dependencies = dependencies;
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
    const runner = picaAcpRunner(input.agent);
    const run: PicaAcpRun = { runner, options: runner.runOptions(input.agent) };
    const session = await this.dependencies.sessions.require(
      input.actor,
      input.request.sessionId,
    );
    const launch = (): Promise<ChatJobStart> =>
      this.gate(session.id, () => this.launch(input, session.id, run));
    return this.dependencies.admit ? this.dependencies.admit(launch) : launch();
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

  /** Stops the running job of an own conversation on the person's explicit request. */
  public async stop(actor: User, sessionId: unknown): Promise<void> {
    const id = readChatSessionId(sessionId);
    await this.dependencies.sessions.require(actor, id);
    this.cancel(actor.id, id);
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
    if (entry?.job.userId !== userId) return;
    this.cancel(userId, sessionId);
    await entry.completion;
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
      if (!this.running.has(sessionId)) this.queues.delete(sessionId);
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
    await this.dependencies.requireCurrent?.(actor.id, agent);
    if (this.deleting.has(sessionId)) throw new ChatError("sessionMissing");
    if (this.running.has(sessionId))
      throw new AgentExecutionError("requestBusy");
    const id = randomUUID();
    // Refused before anything is stored, as the API path refuses a second answer.
    this.dependencies.requests.requireAdmission(actor.id, id);
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
    const job = new PicaAcpJob(this.dependencies, {
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
    });
    this.register(sessionId, job);
    const started = await this.dependencies.jobs.find(actor.id, id);
    if (started === null) throw new ChatError("sessionMissing");
    return { job: started, messageId: message.id };
  }

  private register(sessionId: string, job: PicaAcpJob): void {
    let completed: Promise<void>;
    try {
      completed = this.dependencies.requests.start(
        job.userId,
        job.id,
        (signal) => job.run(signal),
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
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(sessionId, queue);
    }
    return queue.run(task);
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

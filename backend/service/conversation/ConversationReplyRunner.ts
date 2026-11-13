import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  CONVERSATION_AGENT_CONTEXT_MESSAGES,
  CONVERSATION_AGENT_REPLY_PREFIX,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";

import { createConversationAgentPrompt } from "./ConversationAgentPrompt";
import { findConversationMentions } from "./ConversationMentions";
import { toConversationMessage } from "./ConversationReader";
import { agentSelectionText } from "./content/ConversationAgentFiles";
import { EMPTY_MESSAGE_CONTENT } from "./content/ConversationMessageContent";

import type {
  ConversationMessageRepository,
  StoredConversationMessage,
} from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationRecord,
  ConversationRepository,
} from "@/backend/database/repositories/conversation/ConversationRepository";
import type {
  ConversationRoundRepository,
  ConversationTargetState,
} from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { AgentMessageQueue } from "@/definition/AgentSessionLimits";
import type {
  ConversationMessage,
  ConversationNotice,
} from "@/definition/Conversation";
import type { ConversationReplyTrigger } from "@/definition/ConversationObserver";
import type { User } from "@/definition/User";
import type { ConversationAgentGuard } from "./ConversationAgentGuard";
import type {
  AgentFile,
  ConversationAgentFiles,
} from "./content/ConversationAgentFiles";
import type { ConversationAttachments } from "./content/ConversationAttachments";
import type { ConversationMessageContentReader } from "./content/ConversationMessageContent";
import type {
  ConversationAgentRequest,
  ConversationAgentRunner,
} from "./ConversationAgentReplies";
import type { ConversationContextReader } from "./ConversationContextReader";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type { ConversationEvents } from "./ConversationEvents";

const COMPONENT = "ConversationAgentReplies";

/** How long an answer waits for an agent that is busy before it tries again. */
const BUSY_RETRY_MILLISECONDS = 5_000;
/** How long a message waits for a busy agent at most: it is queued, never refused. */
const BUSY_WAIT_MAXIMUM_MILLISECONDS = 6 * 3_600_000;

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/** The message of a person and the conversation its round of answers belongs to. */
export interface ConversationRound {
  readonly originMessageId: string;
  readonly conversation: ConversationRecord;
  readonly memberIds: readonly string[];
  /** The person who wrote the message. */
  readonly person: User;
}

/** One claimed answer of one agent in a round. */
export interface ConversationReplyJob {
  readonly round: ConversationRound;
  readonly agentId: string;
  readonly trigger: ConversationReplyTrigger;
  /** The message the agent answers: the person's, or the answer of another agent. */
  readonly triggerMessageId: string;
  readonly reason: string;
}

/** What one answer of an agent uses. */
export interface ConversationReplyRunnerDependencies {
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly messages: Pick<
    ConversationMessageRepository,
    "find" | "history" | "insert"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly runner: ConversationAgentRunner;
  readonly rounds: Pick<ConversationRoundRepository, "setTargetState">;
  readonly contexts: Pick<ConversationContextReader, "promptContext">;
  readonly events: Pick<ConversationEvents, "publish">;
  readonly publisher: { publish(event: PagesEvent): void };
  /** Pauses a chain of agent messages (PAGE-311); without it no chain is limited. */
  readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  /** Reads the file lines of an answer (PAGE-298). */
  readonly agentFiles: Pick<ConversationAgentFiles, "select" | "open">;
  /** Stores the files an answer attaches and binds them to it. */
  readonly attachments: Pick<
    ConversationAttachments,
    "stage" | "bind" | "release"
  >;
  /** The attachments and links of the stored answer. */
  readonly content: ConversationMessageContentReader;
  readonly now?: () => Date;
  /** Waits for a busy agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

const NOTICE_TEXTS: Readonly<
  Record<ConversationNotice, (name: string) => string>
> = {
  agent_inactive: (name) =>
    `${name} ist deaktiviert und antwortet nicht auf diese Nachricht.`,
  agent_cost_limit: (name) =>
    `${name} antwortet nicht: Das Kostenlimit des Agents ist erreicht.`,
  agent_unavailable: (name) =>
    `${name} antwortet nicht: Für den Agent ist gerade kein Modell nutzbar.`,
  agent_failed: (name) =>
    `${name} konnte nicht antworten, die Antwort ist fehlgeschlagen. Schreib die Nachricht erneut, um es noch einmal zu versuchen.`,
  agent_stopped: (name) => `Die Antwort von ${name} wurde gestoppt.`,
};

function changedEvent(conversationId: string): PagesEvent {
  return { type: "conversation.changed", id: conversationId };
}

function noticeFor(error: unknown): ConversationNotice {
  if (!(error instanceof AgentEmployeeError)) return "agent_failed";
  if (error.code === "inactive") return "agent_inactive";
  return error.code === "unavailable" ||
    error.code === "accessUnsupported" ||
    error.code === "modelNotAllowed"
    ? "agent_unavailable"
    : "agent_failed";
}

/**
 * Runs the claimed answers of agents (PAGE-276, PAGE-296), one after the
 * other per agent and conversation.
 *
 * @remarks
 * Before it starts, the agent must still be a member of the conversation.
 * The answer runs as the agent's own account with its own model,
 * instructions and rights; why it was asked never adds a right. While it
 * works the members see it. A failed answer, a deactivated agent or a
 * missing model leave a hint in the agent's name instead, and the stored
 * state of the answer says so: answered only with a stored answer. Each
 * agent stores at most one answer or hint per round.
 *
 * Every agent answers in its own session of the conversation (PAGE-304), so
 * several agents answer side by side. An answer that waits for the earlier
 * answer of the same agent, or for a free place among the limits of
 * concurrent sessions, shows as queued until it begins, and a member can
 * stop the running answer of one agent.
 */
export class ConversationReplyRunner {
  private readonly dependencies: ConversationReplyRunnerDependencies;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly working = new Map<string, Set<string>>();
  /** Waiting answers by conversation, keyed by answered message and agent. */
  private readonly queued = new Map<
    string,
    Map<
      string,
      { readonly messageId: string; readonly reason: AgentMessageQueue }
    >
  >();
  /** The stop of the running answer, by conversation and agent. */
  private readonly controllers = new Map<string, AbortController>();
  /** The rounds handed to the running answer of an agent in a conversation (PAGE-376). */
  private readonly steered = new Map<string, ConversationReplyJob[]>();

  public constructor(dependencies: ConversationReplyRunnerDependencies) {
    this.dependencies = dependencies;
  }

  /** The agents that are answering in a conversation now. */
  public workingAgentIds(conversationId: string): string[] {
    return [...(this.working.get(conversationId) ?? [])];
  }

  /**
   * The messages of a conversation whose answer waits, and why (PAGE-304).
   *
   * @returns By message ID; `limit` wins over `chat` when several agents wait.
   */
  public queuedMessages(
    conversationId: string,
  ): ReadonlyMap<string, AgentMessageQueue> {
    const result = new Map<string, AgentMessageQueue>();
    for (const { messageId, reason } of this.queued
      .get(conversationId)
      ?.values() ?? [])
      if (result.get(messageId) !== "limit") result.set(messageId, reason);
    return result;
  }

  /**
   * How many messages of a conversation wait for the answer of one agent: for
   * its running answer, or for a free place (PAGE-376).
   */
  public queuedFor(conversationId: string, agentId: string): number {
    return [...(this.queued.get(conversationId)?.keys() ?? [])].filter((key) =>
      key.endsWith(`:${agentId}`),
    ).length;
  }

  /**
   * Stops the running answer of one agent in a conversation.
   *
   * @returns Whether an answer was running and is stopped now.
   */
  public stop(conversationId: string, agentId: string): boolean {
    const controller = this.controllers.get(`${conversationId}:${agentId}`);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  /**
   * Runs a claimed answer: handed to the answer the agent is giving in the
   * conversation now, or after the earlier answers of the same agent in the
   * same conversation (PAGE-376).
   *
   * @returns The stored answer, or `null` for a hint, no answer or a round
   * the running answer took over.
   */
  public run(job: ConversationReplyJob): Promise<ConversationMessage | null> {
    const queueKey = `${job.round.conversation.id}:${job.agentId}`;
    if (!this.queues.has(queueKey)) return this.enqueue(job, queueKey);
    return this.steerElseEnqueue(job, queueKey);
  }

  /** Hands the round to the running answer; when that is not possible it waits for its own turn. */
  private async steerElseEnqueue(
    job: ConversationReplyJob,
    queueKey: string,
  ): Promise<ConversationMessage | null> {
    if (await this.trySteer(job, queueKey)) return null;
    return this.enqueue(job, queueKey);
  }

  private enqueue(
    job: ConversationReplyJob,
    queueKey: string,
  ): Promise<ConversationMessage | null> {
    const previous = this.queues.get(queueKey);
    if (previous) this.markQueued(job, "chat");
    const next = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.reply(job));
    this.queues.set(queueKey, next);
    return next.finally(() => {
      if (this.queues.get(queueKey) === next) this.queues.delete(queueKey);
    });
  }

  /**
   * Hands a round to the answer the agent gives now (PAGE-376): the new
   * messages join that answer, so the conversation gets no second answer and
   * the agent no second session.
   */
  private async trySteer(
    job: ConversationReplyJob,
    queueKey: string,
  ): Promise<boolean> {
    const { runner, directory } = this.dependencies;
    if (!runner.steer || !this.controllers.has(queueKey)) return false;
    const accounts = await directory.read();
    const agent = accounts.find(job.agentId);
    if (agent?.user.isAgent !== true || !agent.user.isActive) return false;
    try {
      const request = await this.buildRequest(job, agent.user, accounts);
      if (!(await runner.steer(request))) return false;
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      return false;
    }
    await this.setState(job, "running");
    this.steered.set(queueKey, [...(this.steered.get(queueKey) ?? []), job]);
    this.markQueued(job, "chat");
    return true;
  }

  /** Settles the rounds that joined the running answer once it ended. */
  private async settleSteered(
    queueKey: string,
    outcome: {
      readonly state: ConversationTargetState;
      readonly replyMessageId?: string;
      readonly notice?: ConversationNotice | null;
    },
  ): Promise<void> {
    const jobs = this.steered.get(queueKey) ?? [];
    this.steered.delete(queueKey);
    for (const job of jobs) {
      this.unmarkQueued(job);
      await this.setState(job, outcome.state, {
        ...(outcome.replyMessageId === undefined
          ? {}
          : { replyMessageId: outcome.replyMessageId }),
        ...(outcome.notice === undefined ? {} : { notice: outcome.notice }),
      });
    }
  }

  /** Answers one message as one agent, or leaves a hint why it did not. */
  private async reply(
    job: ConversationReplyJob,
  ): Promise<ConversationMessage | null> {
    this.unmarkQueued(job);
    const accounts = await this.dependencies.directory.read();
    const agent = accounts.find(job.agentId);
    const membership = await this.dependencies.conversations.findForMember(
      job.round.conversation.id,
      job.agentId,
    );
    if (!agent || agent.user.isAgent !== true || !membership) {
      await this.setState(job, "failed");
      return null;
    }
    if (!agent.user.isActive) {
      await this.post(job, accounts, {
        text: NOTICE_TEXTS.agent_inactive(agent.user.displayName),
        notice: "agent_inactive",
      });
      return null;
    }
    if (await this.isPausedChain(job)) {
      await this.setState(job, "failed");
      return null;
    }
    await this.setState(job, "running");
    const controllerKey = `${job.round.conversation.id}:${job.agentId}`;
    const controller = new AbortController();
    this.controllers.set(controllerKey, controller);
    this.setWorking(job, true);
    try {
      const text = await this.askWhenFree(job, agent.user, {
        accounts,
        signal: controller.signal,
      });
      const posted = await this.post(job, accounts, { text, notice: null });
      await this.settleSteered(controllerKey, {
        state: "answered",
        ...(posted ? { replyMessageId: posted.id } : {}),
      });
      return posted;
    } catch (error: unknown) {
      const notice = controller.signal.aborted
        ? "agent_stopped"
        : noticeFor(error);
      this.logFailure(job, notice, error);
      await this.post(job, accounts, {
        text: NOTICE_TEXTS[notice](agent.user.displayName),
        notice,
      });
      await this.settleSteered(controllerKey, { state: "failed", notice });
      return null;
    } finally {
      if (this.controllers.get(controllerKey) === controller)
        this.controllers.delete(controllerKey);
      this.unmarkQueued(job);
      this.setWorking(job, false);
    }
  }

  /** Whether the round began with an agent in a conversation whose chain of agent messages is used up (PAGE-311). */
  private async isPausedChain(job: ConversationReplyJob): Promise<boolean> {
    if (job.round.person.isAgent !== true || !this.dependencies.guard)
      return false;
    return this.dependencies.guard.isPaused(job.round.conversation.id);
  }

  /** Asks the agent; while it is busy with another job the message waits for its turn (PAGE-311). */
  private async askWhenFree(
    job: ConversationReplyJob,
    agent: User,
    context: {
      readonly accounts: ConversationAccounts;
      readonly signal: AbortSignal;
    },
  ): Promise<string> {
    const deadline = this.nowMilliseconds() + BUSY_WAIT_MAXIMUM_MILLISECONDS;
    for (;;) {
      try {
        return await this.ask(job, agent, context);
      } catch (error: unknown) {
        const isBusy =
          error instanceof AgentEmployeeError && error.code === "busy";
        if (!isBusy || this.nowMilliseconds() > deadline) throw error;
        await (this.dependencies.wait ?? defaultWait)(BUSY_RETRY_MILLISECONDS);
      }
    }
  }

  /** Shows the answered message as queued for the agent of the job. */
  private markQueued(
    job: ConversationReplyJob,
    reason: AgentMessageQueue,
  ): void {
    const conversationId = job.round.conversation.id;
    const entries = this.queued.get(conversationId) ?? new Map();
    entries.set(`${job.triggerMessageId}:${job.agentId}`, {
      messageId: job.triggerMessageId,
      reason,
    });
    this.queued.set(conversationId, entries);
    this.dependencies.publisher.publish(changedEvent(conversationId));
  }

  private unmarkQueued(job: ConversationReplyJob): void {
    const conversationId = job.round.conversation.id;
    const entries = this.queued.get(conversationId);
    if (!entries?.delete(`${job.triggerMessageId}:${job.agentId}`)) return;
    if (entries.size === 0) this.queued.delete(conversationId);
    this.dependencies.publisher.publish(changedEvent(conversationId));
  }

  /**
   * What an agent is asked in a round (PAGE-376): the whole chat context for
   * a session that does not know the chat yet, otherwise only the messages
   * after the position of its session.
   */
  private async buildRequest(
    job: ConversationReplyJob,
    agent: User,
    accounts: ConversationAccounts,
  ): Promise<Omit<ConversationAgentRequest, "signal">> {
    const { messages, runner } = this.dependencies;
    const { conversation } = job.round;
    const answered = await messages.find(conversation.id, job.triggerMessageId);
    const origin = await messages.find(
      conversation.id,
      job.round.originMessageId,
    );
    if (!answered || !origin)
      throw new Error("The answered message is missing.");
    const deliveredThrough =
      (await runner.deliveredThrough?.(agent.id, conversation.id)) ?? 0;
    const newestFirst = await messages.history(
      conversation.id,
      answered.sequence + 1,
      CONVERSATION_AGENT_CONTEXT_MESSAGES,
    );
    // The stored context is part of the opening of a chat, not of its later rounds.
    const groupContext =
      conversation.kind === "group" && deliveredThrough === 0
        ? (await this.dependencies.contexts.promptContext(conversation.id))
            .context
        : null;
    return {
      agent,
      person: job.round.person,
      conversation,
      prompt: createConversationAgentPrompt({
        conversation,
        agentId: agent.id,
        newestFirst,
        accounts,
        trigger: {
          kind: job.trigger,
          reason: job.reason,
          personId: job.round.person.id,
          originSequence: origin.sequence,
        },
        context: groupContext,
        memberIds: job.round.memberIds,
        deliveredThrough,
      }),
      lastMessage: answered.text,
      throughSequence: answered.sequence,
    };
  }

  /** Asks the agent; an empty answer counts as failed. */
  private async ask(
    job: ConversationReplyJob,
    agent: User,
    context: {
      readonly accounts: ConversationAccounts;
      readonly signal: AbortSignal;
    },
  ): Promise<string> {
    const request = await this.buildRequest(job, agent, context.accounts);
    const answer = await this.dependencies.runner.answer({
      ...request,
      signal: context.signal,
      onQueued: () => this.markQueued(job, "limit"),
      onAdmitted: () => this.unmarkQueued(job),
    });
    const text = Array.from(answer.trim())
      .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
      .join("");
    if (text === "") throw new Error("The agent answered with an empty text.");
    return text;
  }

  /**
   * Stores the answer or hint as the agent's message and announces it.
   *
   * @returns The stored answer; `null` for a hint or a repeated store.
   */
  private async post(
    job: ConversationReplyJob,
    accounts: ConversationAccounts,
    reply: {
      readonly text: string;
      readonly notice: ConversationNotice | null;
    },
  ): Promise<ConversationMessage | null> {
    const { conversation, memberIds } = job.round;
    // A hint of Pages attaches nothing; an answer attaches its file lines.
    const selection =
      reply.notice === null
        ? await this.dependencies.agentFiles.select(reply.text)
        : null;
    // The files are stored first, so a file that fails keeps its line with the reason.
    const staged = selection
      ? await this.stageFiles(conversation.id, job.agentId, selection.files)
      : { attachmentIds: [], failed: [] };
    const text = Array.from(
      selection ? agentSelectionText(selection, staged.failed) : reply.text,
    )
      .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
      .join("");
    // An answer mentions as a person's message does, so it can hand over (PAGE-296).
    const mentions =
      reply.notice === null && conversation.kind === "group"
        ? findConversationMentions(text, memberIds, {
            accounts,
            senderId: job.agentId,
          })
        : [];
    let outcome: Awaited<
      ReturnType<ConversationReplyRunnerDependencies["messages"]["insert"]>
    >;
    try {
      outcome = await this.dependencies.messages.insert(
        {
          id: randomUUID(),
          conversationId: conversation.id,
          senderId: job.agentId,
          // One answer or hint per agent and round, also after a repeated event or a restart.
          clientMessageId: `${CONVERSATION_AGENT_REPLY_PREFIX}${job.round.originMessageId}`,
          text,
          mentions,
          createdAt: this.now(),
          voice: null,
          notice: reply.notice,
        },
        changedEvent(conversation.id),
      );
    } catch (error: unknown) {
      await this.releaseFiles(job.agentId, staged.attachmentIds);
      throw error;
    }
    await this.setState(job, reply.notice === null ? "answered" : "failed", {
      replyMessageId: outcome.message.id,
      notice: reply.notice,
    });
    if (!outcome.isNew) {
      // A repeated store keeps the first answer; the copies of this one go.
      await this.releaseFiles(job.agentId, staged.attachmentIds);
      return null;
    }
    await this.bindFiles(outcome.message, staged.attachmentIds);
    const content = await this.dependencies.content.describe([outcome.message]);
    const message = toConversationMessage(
      outcome.message,
      accounts,
      content.get(outcome.message.id) ?? EMPTY_MESSAGE_CONTENT,
    );
    this.dependencies.publisher.publish(changedEvent(conversation.id));
    this.dependencies.events.publish({
      kind: "message",
      message,
      recipientIds: memberIds,
    });
    return reply.notice === null ? message : null;
  }

  /**
   * Copies the files an answer named into the file store, without a message
   * yet.
   *
   * @returns The stored attachments in their order, and the files that failed.
   */
  private async stageFiles(
    conversationId: string,
    agentId: string,
    files: readonly AgentFile[],
  ): Promise<{ attachmentIds: string[]; failed: AgentFile[] }> {
    const attachmentIds: string[] = [];
    const failed: AgentFile[] = [];
    for (const file of files) {
      try {
        const stored = await this.dependencies.attachments.stage(
          { conversationId, senderId: agentId },
          {
            name: file.name,
            mimeType: file.mimeType,
            source: this.dependencies.agentFiles.open(file),
          },
        );
        attachmentIds.push(stored.id);
      } catch (error: unknown) {
        // The line of the file stays in the answer with the reason.
        logCaughtError(COMPONENT, error);
        failed.push(file);
      }
    }
    return { attachmentIds, failed };
  }

  /** Binds the stored files to the stored answer; unbound ones are swept later. */
  private async bindFiles(
    answer: StoredConversationMessage,
    attachmentIds: readonly string[],
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    try {
      await this.dependencies.attachments.bind(
        {
          id: answer.id,
          conversationId: answer.conversationId,
          senderId: answer.senderId,
        },
        attachmentIds,
      );
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      await this.releaseFiles(answer.senderId, attachmentIds);
    }
  }

  /** Removes stored files no answer took; a failure leaves them to the sweep. */
  private async releaseFiles(
    agentId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    if (attachmentIds.length === 0) return;
    try {
      await this.dependencies.attachments.release(agentId, attachmentIds);
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }

  private async setState(
    job: ConversationReplyJob,
    state: ConversationTargetState,
    details: {
      readonly replyMessageId?: string;
      readonly notice?: ConversationNotice | null;
    } = {},
  ): Promise<void> {
    await this.dependencies.rounds.setTargetState(
      { originMessageId: job.round.originMessageId, agentId: job.agentId },
      { state, ...details, updatedAt: this.now() },
    );
  }

  private setWorking(job: ConversationReplyJob, isWorking: boolean): void {
    const conversationId = job.round.conversation.id;
    const agents = this.working.get(conversationId) ?? new Set<string>();
    if (isWorking) agents.add(job.agentId);
    else agents.delete(job.agentId);
    if (agents.size === 0) this.working.delete(conversationId);
    else this.working.set(conversationId, agents);
    this.dependencies.publisher.publish(changedEvent(conversationId));
    this.dependencies.events.publish({
      kind: "typing",
      conversationId,
      participantId: job.agentId,
      isTyping: isWorking,
      recipientIds: job.round.memberIds,
    });
  }

  private logFailure(
    job: ConversationReplyJob,
    notice: ConversationNotice,
    error: unknown,
  ): void {
    if (notice === "agent_failed" || notice === "agent_stopped")
      logCaughtError(COMPONENT, error);
    logEvent({
      level: "warn",
      event: "conversation.agent_reply.refused",
      component: COMPONENT,
      message: "An agent did not answer in a conversation.",
      metadata: {
        conversationId: job.round.conversation.id,
        agentId: job.agentId,
        trigger: job.trigger,
        notice,
      },
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }

  private nowMilliseconds(): number {
    return (this.dependencies.now?.() ?? new Date()).getTime();
  }
}

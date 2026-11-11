import { randomUUID } from "node:crypto";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  CONVERSATION_AGENT_CONTEXT_MESSAGES,
  CONVERSATION_AGENT_REPLY_PREFIX,
  CONVERSATION_AGENT_SEND_PREFIX,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";

import { createConversationAgentPrompt } from "./ConversationAgentPrompt";
import { toConversationMessage } from "./ConversationReader";

import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationRecord,
  ConversationRepository,
} from "@/backend/database/repositories/conversation/ConversationRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  ConversationMessage,
  ConversationNotice,
} from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type { ConversationAgentGuard } from "./ConversationAgentGuard";
import type {
  ConversationEvent,
  ConversationEvents,
} from "./ConversationEvents";

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

/** One answer an agent is asked for. */
export interface ConversationAgentRequest {
  readonly agent: User;
  /** The person, or the agent (PAGE-311), whose message the agent answers. */
  readonly person: User;
  readonly conversation: Pick<ConversationRecord, "id" | "kind" | "name">;
  /** The task with the limited context of the conversation. */
  readonly prompt: string;
  /** The text of the answered message alone. */
  readonly lastMessage: string;
}

/**
 * Runs one answer of an agent with its own model, instructions and rights,
 * or in the simulation.
 *
 * @remarks
 * It refuses with an {@link AgentEmployeeError}: `inactive` for a
 * deactivated agent, `unavailable` where no model can run it.
 */
export interface ConversationAgentRunner {
  answer(request: ConversationAgentRequest): Promise<string>;
}

/** What the answers of agents in conversations use. */
export interface ConversationAgentRepliesDependencies {
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly messages: Pick<
    ConversationMessageRepository,
    "find" | "history" | "insert"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly runner: ConversationAgentRunner;
  /** The in-process channel: the replies follow it and publish to it. */
  readonly events: Pick<ConversationEvents, "subscribe" | "publish">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  /** Pauses a chain of agent messages (PAGE-311); without it no chain is limited. */
  readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  readonly now?: () => Date;
  /** Waits for a busy agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** The answered message with what its answers need. */
interface ReplyJob {
  readonly message: ConversationMessage;
  readonly memberIds: readonly string[];
  readonly conversation: ConversationRecord;
  readonly person: User;
  readonly agentId: string;
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

/** The message a person wrote whose text is known now, or `null` for every other change. */
function answerableMessage(
  event: ConversationEvent,
): ConversationMessage | null {
  if (event.kind !== "message" && event.kind !== "message_updated") return null;
  const { message } = event;
  // A voice message is answered once its text is recognized.
  const isWaiting =
    message.voice !== undefined && message.voice.transcriptionState !== "done";
  if (event.kind === "message_updated" && message.voice === undefined)
    return null;
  if (isWaiting || message.notice !== undefined) return null;
  if (message.text.trim() === "") return null;
  return isAskingMessage(message) ? message : null;
}

/**
 * Whether a message asks for an answer: one a person wrote, or one an agent
 * chose to send (PAGE-311). The answer of an agent asks nobody, so two agents
 * never answer each other on their own.
 */
function isAskingMessage(message: ConversationMessage): boolean {
  return (
    message.sender.kind === "human" ||
    message.clientMessageId.startsWith(CONVERSATION_AGENT_SEND_PREFIX)
  );
}

/**
 * The answers of agents in conversations (PAGE-276).
 *
 * @remarks
 * In a direct conversation the agent answers every message of the person;
 * in a group an agent answers only when the message mentions it, each
 * mentioned agent once. An agent answers a message of another agent only when
 * that agent chose to send it (PAGE-311); an answer asks nobody, and a
 * conversation paused after a chain of agent messages gets none. While it
 * works, the members see it (`typing`). A message for a busy agent is queued
 * and answered once the agent is free, never refused. A failed
 * answer, a deactivated agent, a reached cost limit or a missing model leave
 * a hint in the agent's name instead, and nothing is started again. The
 * answers of one agent run one after the other, and each answered message
 * gets at most one answer or hint per agent.
 */
export class ConversationAgentReplies {
  private readonly dependencies: ConversationAgentRepliesDependencies;
  private readonly started = new Set<string>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly working = new Map<string, Set<string>>();

  public constructor(dependencies: ConversationAgentRepliesDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Follows the committed messages of the process.
   *
   * @returns Stops following.
   */
  public start(): () => void {
    return this.dependencies.events.subscribe((event) => {
      this.receive(event);
    });
  }

  /** The agents that are answering in a conversation now. */
  public workingAgentIds(conversationId: string): string[] {
    return [...(this.working.get(conversationId) ?? [])];
  }

  /**
   * Starts the answers a message asks for and returns once they ended.
   *
   * @param message - A committed message.
   * @param memberIds - The members of its conversation.
   */
  public async answer(
    message: ConversationMessage,
    memberIds: readonly string[],
  ): Promise<void> {
    const accounts = await this.dependencies.directory.read();
    const sender = accounts.find(message.sender.id);
    if (!sender || !isAskingMessage(message)) return;
    const conversation = await this.dependencies.conversations.findForMember(
      message.conversationId,
      sender.user.id,
    );
    if (!conversation) return;
    const agentIds = this.addressedAgents(
      { message, memberIds, conversation },
      accounts,
    );
    await Promise.all(
      agentIds.map((agentId) =>
        this.enqueue({
          message,
          memberIds,
          conversation,
          person: sender.user,
          agentId,
        }),
      ),
    );
  }

  private receive(event: ConversationEvent): void {
    const message = answerableMessage(event);
    if (!message) return;
    void withBackgroundDatabaseWork("conversation_agent_reply", () =>
      this.answer(message, event.recipientIds),
    ).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
  }

  /** The agents among the members who answer: the partner of a direct conversation, the mentioned ones of a group. */
  private addressedAgents(
    job: Pick<ReplyJob, "message" | "memberIds" | "conversation">,
    accounts: ConversationAccounts,
  ): string[] {
    const isAgent = (id: string): boolean =>
      id !== job.message.sender.id &&
      job.memberIds.includes(id) &&
      accounts.find(id)?.user.isAgent === true;
    const candidates =
      job.conversation.kind === "direct" ? job.memberIds : job.message.mentions;
    return [...new Set(candidates)].filter(isAgent);
  }

  /** Runs the answer after the earlier answers of the same agent in the same conversation. */
  private enqueue(job: ReplyJob): Promise<void> {
    const key = `${job.agentId}:${job.message.id}`;
    if (this.started.has(key)) return Promise.resolve();
    this.started.add(key);
    // One agent answers one message at a time, whatever the conversation: the others wait their turn.
    const queueKey = job.agentId;
    const previous = this.queues.get(queueKey) ?? Promise.resolve();
    const next = previous.then(() => this.reply(job));
    this.queues.set(queueKey, next);
    return next.finally(() => {
      this.started.delete(key);
      if (this.queues.get(queueKey) === next) this.queues.delete(queueKey);
    });
  }

  /** Answers one message as one agent, or leaves a hint why it did not. */
  private async reply(job: ReplyJob): Promise<void> {
    const accounts = await this.dependencies.directory.read();
    const agent = accounts.find(job.agentId);
    if (!agent) return;
    if (!agent.user.isActive) {
      await this.post(job, accounts, {
        text: NOTICE_TEXTS.agent_inactive(agent.user.displayName),
        notice: "agent_inactive",
      });
      return;
    }
    if (await this.isPausedChain(job)) return;
    this.setWorking(job, true);
    try {
      const text = await this.askWhenFree(job, agent.user, accounts);
      await this.post(job, accounts, { text, notice: null });
    } catch (error: unknown) {
      const notice = noticeFor(error);
      this.logFailure(job, notice, error);
      await this.post(job, accounts, {
        text: NOTICE_TEXTS[notice](agent.user.displayName),
        notice,
      });
    } finally {
      this.setWorking(job, false);
    }
  }

  /** Whether the message came from an agent into a conversation whose chain of agent messages is used up. */
  private async isPausedChain(job: ReplyJob): Promise<boolean> {
    if (job.person.isAgent !== true || !this.dependencies.guard) return false;
    return this.dependencies.guard.isPaused(job.conversation.id);
  }

  /** Asks the agent; while it is busy with another job the message waits for its turn. */
  private async askWhenFree(
    job: ReplyJob,
    agent: User,
    accounts: ConversationAccounts,
  ): Promise<string> {
    const now = (): number =>
      (this.dependencies.now?.() ?? new Date()).getTime();
    const deadline = now() + BUSY_WAIT_MAXIMUM_MILLISECONDS;
    for (;;) {
      try {
        return await this.ask(job, agent, accounts);
      } catch (error: unknown) {
        const isBusy =
          error instanceof AgentEmployeeError && error.code === "busy";
        if (!isBusy || now() > deadline) throw error;
        await (this.dependencies.wait ?? defaultWait)(BUSY_RETRY_MILLISECONDS);
      }
    }
  }

  /** Asks the agent with the limited context; an empty answer counts as failed. */
  private async ask(
    job: ReplyJob,
    agent: User,
    accounts: ConversationAccounts,
  ): Promise<string> {
    const { messages } = this.dependencies;
    const stored = await messages.find(job.conversation.id, job.message.id);
    if (!stored) throw new Error("The answered message is missing.");
    const newestFirst = await messages.history(
      job.conversation.id,
      stored.sequence + 1,
      CONVERSATION_AGENT_CONTEXT_MESSAGES,
    );
    const answer = await this.dependencies.runner.answer({
      agent,
      person: job.person,
      conversation: job.conversation,
      prompt: createConversationAgentPrompt({
        conversation: job.conversation,
        agentId: agent.id,
        newestFirst,
        accounts,
      }),
      lastMessage: stored.text,
    });
    const text = Array.from(answer.trim())
      .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
      .join("");
    if (text === "") throw new Error("The agent answered with an empty text.");
    return text;
  }

  /** Stores the answer or hint as the agent's message and announces it. */
  private async post(
    job: ReplyJob,
    accounts: ConversationAccounts,
    reply: {
      readonly text: string;
      readonly notice: ConversationNotice | null;
    },
  ): Promise<void> {
    const conversationId = job.conversation.id;
    const outcome = await this.dependencies.messages.insert(
      {
        id: randomUUID(),
        conversationId,
        senderId: job.agentId,
        // One answer or hint per agent and answered message, also after a repeated event.
        clientMessageId: `${CONVERSATION_AGENT_REPLY_PREFIX}${job.message.id}`,
        text: reply.text,
        mentions: [],
        createdAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        voice: null,
        notice: reply.notice,
      },
      changedEvent(conversationId),
    );
    if (!outcome.isNew) return;
    this.dependencies.publisher.publish(changedEvent(conversationId));
    this.dependencies.events.publish({
      kind: "message",
      message: toConversationMessage(outcome.message, accounts),
      recipientIds: job.memberIds,
    });
  }

  private setWorking(job: ReplyJob, isWorking: boolean): void {
    const conversationId = job.conversation.id;
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
      recipientIds: job.memberIds,
    });
  }

  private logFailure(
    job: ReplyJob,
    notice: ConversationNotice,
    error: unknown,
  ): void {
    if (notice === "agent_failed") logCaughtError(COMPONENT, error);
    logEvent({
      level: "warn",
      event: "conversation.agent_reply.refused",
      component: COMPONENT,
      message: "An agent did not answer in a conversation.",
      metadata: {
        conversationId: job.conversation.id,
        agentId: job.agentId,
        notice,
      },
    });
  }
}

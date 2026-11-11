import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  CONVERSATION_AGENT_CONTEXT_MESSAGES,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";

import { createConversationAgentPrompt } from "./ConversationAgentPrompt";
import { findConversationMentions } from "./ConversationMentions";
import { toConversationMessage } from "./ConversationReader";
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
import type {
  ConversationMessage,
  ConversationNotice,
} from "@/definition/Conversation";
import type { ConversationReplyTrigger } from "@/definition/ConversationObserver";
import type { User } from "@/definition/User";
import type {
  AgentFile,
  ConversationAgentFiles,
} from "./content/ConversationAgentFiles";
import type { ConversationAttachments } from "./content/ConversationAttachments";
import type { ConversationMessageContentReader } from "./content/ConversationMessageContent";
import type { ConversationAgentRunner } from "./ConversationAgentReplies";
import type { ConversationContextReader } from "./ConversationContextReader";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type { ConversationEvents } from "./ConversationEvents";

const COMPONENT = "ConversationAgentReplies";

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
  /** Reads the file lines of an answer (PAGE-298). */
  readonly agentFiles: Pick<ConversationAgentFiles, "select" | "open">;
  /** Stores the files an answer attaches. */
  readonly attachments: Pick<ConversationAttachments, "attach">;
  /** The attachments and links of the stored answer. */
  readonly content: ConversationMessageContentReader;
  readonly now?: () => Date;
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
 */
export class ConversationReplyRunner {
  private readonly dependencies: ConversationReplyRunnerDependencies;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly working = new Map<string, Set<string>>();

  public constructor(dependencies: ConversationReplyRunnerDependencies) {
    this.dependencies = dependencies;
  }

  /** The agents that are answering in a conversation now. */
  public workingAgentIds(conversationId: string): string[] {
    return [...(this.working.get(conversationId) ?? [])];
  }

  /**
   * Runs a claimed answer after the earlier answers of the same agent in the
   * same conversation.
   *
   * @returns The stored answer, or `null` for a hint or no answer.
   */
  public run(job: ConversationReplyJob): Promise<ConversationMessage | null> {
    const queueKey = `${job.round.conversation.id}:${job.agentId}`;
    const previous = this.queues.get(queueKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.reply(job));
    this.queues.set(queueKey, next);
    return next.finally(() => {
      if (this.queues.get(queueKey) === next) this.queues.delete(queueKey);
    });
  }

  /** Answers one message as one agent, or leaves a hint why it did not. */
  private async reply(
    job: ConversationReplyJob,
  ): Promise<ConversationMessage | null> {
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
    await this.setState(job, "running");
    this.setWorking(job, true);
    try {
      const text = await this.ask(job, agent.user, accounts);
      return await this.post(job, accounts, { text, notice: null });
    } catch (error: unknown) {
      const notice = noticeFor(error);
      this.logFailure(job, notice, error);
      await this.post(job, accounts, {
        text: NOTICE_TEXTS[notice](agent.user.displayName),
        notice,
      });
      return null;
    } finally {
      this.setWorking(job, false);
    }
  }

  /** Asks the agent with the limited context; an empty answer counts as failed. */
  private async ask(
    job: ConversationReplyJob,
    agent: User,
    accounts: ConversationAccounts,
  ): Promise<string> {
    const { messages } = this.dependencies;
    const { conversation } = job.round;
    const answered = await messages.find(conversation.id, job.triggerMessageId);
    const origin = await messages.find(
      conversation.id,
      job.round.originMessageId,
    );
    if (!answered || !origin)
      throw new Error("The answered message is missing.");
    const newestFirst = await messages.history(
      conversation.id,
      answered.sequence + 1,
      CONVERSATION_AGENT_CONTEXT_MESSAGES,
    );
    const context =
      conversation.kind === "group"
        ? (await this.dependencies.contexts.promptContext(conversation.id))
            .context
        : null;
    const answer = await this.dependencies.runner.answer({
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
        context,
        memberIds: job.round.memberIds,
      }),
      lastMessage: answered.text,
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
        : { text: reply.text, files: [] };
    const text = Array.from(selection.text)
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
    const outcome = await this.dependencies.messages.insert(
      {
        id: randomUUID(),
        conversationId: conversation.id,
        senderId: job.agentId,
        // One answer or hint per agent and round, also after a repeated event or a restart.
        clientMessageId: `reply-${job.round.originMessageId}`,
        text,
        mentions,
        createdAt: this.now(),
        voice: null,
        notice: reply.notice,
      },
      changedEvent(conversation.id),
    );
    await this.setState(job, reply.notice === null ? "answered" : "failed", {
      replyMessageId: outcome.message.id,
      notice: reply.notice,
    });
    if (!outcome.isNew) return null;
    await this.attachFiles(outcome.message, selection.files);
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

  /** Copies the files an answer named into the file store, as attachments of the answer. */
  private async attachFiles(
    answer: StoredConversationMessage,
    files: readonly AgentFile[],
  ): Promise<void> {
    for (const [position, file] of files.entries()) {
      try {
        await this.dependencies.attachments.attach(
          {
            conversationId: answer.conversationId,
            messageId: answer.id,
            senderId: answer.senderId,
            position,
          },
          {
            name: file.name,
            mimeType: file.mimeType,
            source: this.dependencies.agentFiles.open(file),
          },
        );
      } catch (error: unknown) {
        // The answer stays; a file that vanished since the check is missing in it.
        logCaughtError(COMPONENT, error);
      }
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
    if (notice === "agent_failed") logCaughtError(COMPONENT, error);
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
}

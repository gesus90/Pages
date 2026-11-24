import { randomUUID } from "node:crypto";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  CONVERSATION_AGENT_INTERIM_PREFIX,
  CONVERSATION_AGENT_QUESTION_PREFIX,
} from "@/definition/AgentChatQuestion";

import {
  answeredOutcome,
  questionItems,
  questionText,
  readQuestionAnswers,
} from "./AgentChatQuestionItems";
import { changedEvent } from "./ConversationReplyNotices";

import type {
  AgentChatQuestionRepository,
  StoredAgentQuestion,
} from "@/backend/database/repositories/conversation/AgentChatQuestionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  AgentChatInteractions,
  AgentQuestionAnswer,
  AgentQuestionOutcome,
  AgentQuestionRequest,
  AgentQuestionView,
} from "@/definition/AgentChatQuestion";
import type { User } from "@/definition/User";
import type { ConversationReader } from "./ConversationReader";
import type { ConversationService } from "./ConversationService";

/** The answer that ends the wait of a question. */
interface QuestionReply {
  readonly answers: readonly AgentQuestionAnswer[];
  readonly answeredBy: string;
}

interface Waiter {
  readonly agentId: string;
  readonly conversationId: string;
  readonly resolve: (reply: QuestionReply) => void;
}

/**
 * The questions whose round waits in this process, by question ID.
 * @remarks
 * The answer may arrive through another wiring of the services than the
 * one the job asked through, so the waits belong to the process.
 */
export class AgentQuestionWaiters {
  private readonly waiters = new Map<string, Waiter>();

  /** Registers the wait of a question. */
  public add(questionId: string, waiter: Waiter): void {
    this.waiters.set(questionId, waiter);
  }

  /** Ends the wait of a question with its answer; nothing without a wait. */
  public resolve(questionId: string, reply: QuestionReply): void {
    const waiter = this.waiters.get(questionId);
    this.waiters.delete(questionId);
    waiter?.resolve(reply);
  }

  /** Forgets the wait of a question that ended otherwise. */
  public remove(questionId: string): void {
    this.waiters.delete(questionId);
  }

  /** Whether an agent waits for an answer, in one conversation or in any. */
  public isWaiting(agentId: string, conversationId?: string): boolean {
    return [...this.waiters.values()].some(
      (waiter) =>
        waiter.agentId === agentId &&
        (conversationId === undefined ||
          waiter.conversationId === conversationId),
    );
  }
}

const PROCESS_WAITERS = new AgentQuestionWaiters();

/** The chat a job's interim messages and questions go to. */
export type AgentQuestionChat =
  | { readonly kind: "direct"; readonly personId: string }
  | {
      readonly kind: "conversation";
      readonly conversationId: string;
      /** The person who addressed the agent; `null` lets every human member answer. */
      readonly askerId: string | null;
    };

/** What the interim messages and questions of agents use. */
export interface AgentChatQuestionDependencies {
  readonly users: Pick<UserRepository, "findById">;
  readonly service: Pick<ConversationService, "send" | "openDirect">;
  readonly reader: Pick<ConversationReader, "memberIds">;
  readonly questions: Pick<
    AgentChatQuestionRepository,
    "insert" | "find" | "findByMessageIds" | "answer" | "close"
  >;
  readonly publisher: { publish(event: PagesEvent): void };
  readonly waiters?: AgentQuestionWaiters;
  readonly now?: () => Date;
  readonly createId?: () => string;
  /** Waits the time limit of a question unless the signal ends it first; tests pass a fast one. */
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Whether a person may answer the question now. */
function mayAnswer(
  question: StoredAgentQuestion,
  person: User,
  now: Date,
): boolean {
  return (
    question.status === "open" &&
    new Date(question.expiresAt).getTime() > now.getTime() &&
    person.isAgent !== true &&
    (question.responderId === null || question.responderId === person.id)
  );
}

/**
 * The interim messages and the questions with answer buttons of chat agents.
 * @remarks
 * Both are messages of the agent in the conversation of its chat, sent like
 * any message of the agent, so muting and notifications apply as for an
 * answer. An interim message that names agents of a group with @ asks them,
 * like any message the agent chose to send; the answers of the agents follow
 * from its announcement (see {@link ConversationAgentReplies}). Without an @
 * it asks nobody, and a question never asks another agent. A question waits
 * for one answer, the time limit or the end of its round.
 * In a direct chat the person answers; in a group the person who addressed
 * the agent, otherwise every human member. Agents never answer. The first
 * answer locks the card.
 */
export class AgentChatQuestionService {
  private readonly dependencies: AgentChatQuestionDependencies;
  private readonly waiters: AgentQuestionWaiters;

  public constructor(dependencies: AgentChatQuestionDependencies) {
    this.dependencies = dependencies;
    this.waiters = dependencies.waiters ?? PROCESS_WAITERS;
  }

  /** Binds the interim messages and questions of one job to its agent and chat. */
  public bind(agentId: string, chat: AgentQuestionChat): AgentChatInteractions {
    return {
      say: (text) => this.say(agentId, chat, text),
      ask: (request, signal) => this.ask(agentId, { chat, request, signal }),
    };
  }

  /** Whether an agent's round waits for the answer to a question now. */
  public isWaiting(agentId: string, conversationId?: string): boolean {
    return this.waiters.isWaiting(agentId, conversationId);
  }

  /**
   * Stores the answer of a person to a question and hands it to the waiting agent.
   * @param person - The signed-in person.
   * @param input - `questionId` and `answers`: per question the chosen
   * `optionIds` and an optional `freeText`.
   * @returns The locked card.
   * @throws {ConversationError} `not_found` for an unknown question or one
   * of a conversation the person is no member of, `forbidden` for an agent
   * or a person who may not answer it, `invalid` for a malformed answer or a
   * question that is no longer open, `too_long` for a long free text.
   */
  public async answer(
    person: User,
    input: { readonly questionId: unknown; readonly answers: unknown },
  ): Promise<AgentQuestionView> {
    if (typeof input.questionId !== "string")
      throw new ConversationError("invalid");
    const question = await this.dependencies.questions.find(input.questionId);
    if (!question) throw new ConversationError("not_found");
    const members = await this.dependencies.reader.memberIds(
      question.conversationId,
    );
    if (!members.includes(person.id)) throw new ConversationError("not_found");
    if (question.status !== "open") throw new ConversationError("invalid");
    if (!mayAnswer(question, person, this.now()))
      throw new ConversationError("forbidden");
    const answers = readQuestionAnswers(input.answers, question.items);
    const answeredAt = this.now().toISOString();
    const isStored = await this.dependencies.questions.answer(question.id, {
      answers,
      answeredBy: person.id,
      answeredAt,
    });
    if (!isStored) throw new ConversationError("invalid");
    this.waiters.resolve(question.id, {
      answers,
      answeredBy: person.displayName,
    });
    this.dependencies.publisher.publish(changedEvent(question.conversationId));
    return this.view(
      {
        ...question,
        status: "answered",
        answers,
        answeredBy: person.id,
        answeredAt,
      },
      person,
    );
  }

  /** The cards of the questions the given messages carry, by message ID. */
  public async views(
    person: User,
    messageIds: readonly string[],
  ): Promise<ReadonlyMap<string, AgentQuestionView>> {
    const stored =
      await this.dependencies.questions.findByMessageIds(messageIds);
    const views = await Promise.all(
      stored.map(
        async (question) =>
          [question.messageId, await this.view(question, person)] as const,
      ),
    );
    return new Map(views);
  }

  private async view(
    question: StoredAgentQuestion,
    person: User,
  ): Promise<AgentQuestionView> {
    const now = this.now();
    const responder = question.answeredBy
      ? await this.dependencies.users.findById(question.answeredBy)
      : null;
    // An open question past its limit whose round no longer waits counts as expired.
    const isOverdue =
      question.status === "open" &&
      new Date(question.expiresAt).getTime() <= now.getTime();
    return {
      id: question.id,
      status: isOverdue ? "expired" : question.status,
      items: question.items,
      confirmsTool: question.confirmsTool,
      answers: question.answers,
      answeredBy:
        question.answeredBy === null
          ? null
          : {
              id: question.answeredBy,
              name: responder?.displayName ?? question.answeredBy,
            },
      answeredAt: question.answeredAt,
      expiresAt: question.expiresAt,
      canAnswer: mayAnswer(question, person, now),
    };
  }

  private async say(
    agentId: string,
    chat: AgentQuestionChat,
    text: string,
  ): Promise<{ readonly messageId: string }> {
    const agent = await this.requireAgent(agentId);
    const conversationId = await this.conversationOf(agent, chat);
    const message = await this.dependencies.service.send(agent, {
      conversationId,
      clientMessageId: `${CONVERSATION_AGENT_INTERIM_PREFIX}${this.createId()}`,
      text,
    });
    return { messageId: message.id };
  }

  private async ask(
    agentId: string,
    asking: {
      readonly chat: AgentQuestionChat;
      readonly request: AgentQuestionRequest;
      readonly signal: AbortSignal;
    },
  ): Promise<AgentQuestionOutcome> {
    const { chat, request, signal } = asking;
    const agent = await this.requireAgent(agentId);
    const conversationId = await this.conversationOf(agent, chat);
    const questionId = this.createId();
    const items = questionItems(request.items);
    const message = await this.dependencies.service.send(agent, {
      conversationId,
      clientMessageId: `${CONVERSATION_AGENT_QUESTION_PREFIX}${questionId}`,
      text: questionText(items),
    });
    const now = this.now();
    await this.dependencies.questions.insert({
      id: questionId,
      messageId: message.id,
      conversationId,
      agentId,
      items,
      responderId: chat.kind === "direct" ? chat.personId : chat.askerId,
      confirmsTool: request.confirmation?.tool ?? null,
      expiresAt: new Date(
        now.getTime() + request.timeoutMinutes * 60_000,
      ).toISOString(),
      createdAt: now.toISOString(),
    });
    this.dependencies.publisher.publish(changedEvent(conversationId));
    const reply = await this.await(questionId, {
      agentId,
      conversationId,
      milliseconds: request.timeoutMinutes * 60_000,
      signal,
    });
    if (reply) return answeredOutcome({ id: questionId, items }, reply);
    const status = signal.aborted ? "cancelled" : "expired";
    await this.dependencies.questions.close(questionId, status);
    this.dependencies.publisher.publish(changedEvent(conversationId));
    return { status, questionId };
  }

  /** Waits for the answer; `null` when the limit or the end of the round came first. */
  private async await(
    questionId: string,
    waiting: {
      readonly agentId: string;
      readonly conversationId: string;
      readonly milliseconds: number;
      readonly signal: AbortSignal;
    },
  ): Promise<QuestionReply | null> {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, waiting.signal]);
    const answered = new Promise<QuestionReply>((resolve) => {
      this.waiters.add(questionId, {
        agentId: waiting.agentId,
        conversationId: waiting.conversationId,
        resolve,
      });
    });
    const wait = this.dependencies.wait ?? defaultWait;
    try {
      return await Promise.race([
        answered,
        wait(waiting.milliseconds, signal).then(() => null),
      ]);
    } finally {
      stop.abort();
      this.waiters.remove(questionId);
    }
  }

  private async conversationOf(
    agent: User,
    chat: AgentQuestionChat,
  ): Promise<string> {
    if (chat.kind === "conversation") return chat.conversationId;
    const summary = await this.dependencies.service.openDirect(
      agent,
      chat.personId,
    );
    return summary.id;
  }

  private async requireAgent(agentId: string): Promise<User> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true || !agent.isActive)
      throw new ConversationError("forbidden");
    return agent;
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private createId(): string {
    return this.dependencies.createId?.() ?? randomUUID();
  }
}

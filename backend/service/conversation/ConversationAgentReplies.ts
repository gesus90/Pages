import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ConversationError } from "@/backend/error/ConversationError";
import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import { ConversationReplyRunner } from "./ConversationReplyRunner";

import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationRecord,
  ConversationRepository,
} from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { AgentMessageQueue } from "@/definition/AgentSessionLimits";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationReplySettings } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { ConversationContextReader } from "./ConversationContextReader";
import type {
  ConversationAccount,
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type {
  ConversationEvent,
  ConversationEvents,
} from "./ConversationEvents";
import type { ConversationChatDecisions } from "./ConversationChatDecisions";
import type { ConversationObserverRouting } from "./ConversationObserverRouting";
import type { ObserverCandidate } from "./ConversationObserverPrompts";
import type {
  ConversationReplyJob,
  ConversationRound,
} from "./ConversationReplyRunner";

const COMPONENT = "ConversationAgentReplies";

/** One answer an agent is asked for. */
export interface ConversationAgentRequest {
  readonly agent: User;
  /** The person whose message opened the round the agent answers. */
  readonly person: User;
  readonly conversation: Pick<ConversationRecord, "id" | "kind" | "name">;
  /** The task with the limited context of the conversation. */
  readonly prompt: string;
  /** The text of the answered message alone. */
  readonly lastMessage: string;
  /** Stops the answer, also while it waits for a free place (PAGE-304). */
  readonly signal?: AbortSignal;
  /** Called when the answer waits because the limits of concurrent sessions are reached. */
  readonly onQueued?: () => void;
  /** Called when the answer got its place and begins. */
  readonly onAdmitted?: () => void;
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
  /** The stored rounds, asked agents and routing decisions (PAGE-296). */
  readonly rounds: ConversationRoundRepository;
  /** The stored context of groups, for the prompt of an answer. */
  readonly contexts: Pick<ConversationContextReader, "promptContext">;
  /** The observer that chooses agents by context (PAGE-296). */
  readonly routing: Pick<ConversationObserverRouting, "choose">;
  /** How each group decides who answers without an @ (PAGE-317). */
  readonly replySettings: Pick<ConversationReplySettingsRepository, "find">;
  /** The decision model that chooses agents for a group in decision mode (PAGE-317). */
  readonly decisions: Pick<ConversationChatDecisions, "decide">;
  /** The in-process channel: the replies follow it and publish to it. */
  readonly events: Pick<ConversationEvents, "subscribe" | "publish">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
}

/** One agent a round asks for, and why. */
interface ReplyRequest {
  readonly agentId: string;
  readonly trigger: ConversationReplyJob["trigger"];
  readonly triggerMessageId: string;
  readonly requestedBy: string | null;
  readonly reason: string;
  readonly isAutomatic: boolean;
}

/** The message of a person whose text is known now, or `null` for every other change. */
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
  if (message.sender.kind !== "human" || message.text.trim() === "")
    return null;
  return message;
}

function isAgentMember(
  id: string,
  memberIds: readonly string[],
  accounts: ConversationAccounts,
): boolean {
  return memberIds.includes(id) && accounts.find(id)?.user.isAgent === true;
}

/**
 * The answers of agents in conversations (PAGE-276, PAGE-296).
 *
 * @remarks
 * In a direct conversation the agent answers every message of the person.
 * In a group the agents a person mentions with @ answer at once, each once,
 * and nobody is asked who should answer. A message of a person without such
 * a mention follows the setting of the group (PAGE-317): in `mentions` mode
 * nobody else answers, in `observer` mode the observer is asked once whether
 * an agent should contribute, and in `decision` mode the decision model of
 * the instance chooses, with the default responder as fallback; a failure
 * starts nobody by the observer and blocks nothing else. An answer can hand the
 * round over: the agents it mentions with @ answer, and an answer without
 * such a mention asks the observer once more. Every answer stays in the
 * round of the person's message: each agent answers a round once at most,
 * and the observer and hand-overs add at most
 * {@link CONVERSATION_OBSERVER_LIMITS.automaticRepliesPerOrigin} answers.
 * All of it is stored, so repeated events, concurrent jobs and a restart
 * start nothing twice. Agents never start a round of their own.
 *
 * Every agent answers in its own session of the conversation (PAGE-304), so
 * several agents answer side by side. A message that waits for the earlier
 * answer of the same agent, or for a free place among the limits of
 * concurrent sessions, shows as queued until its answer begins. A member
 * can stop the running answer of one agent; nothing else is touched.
 */
export class ConversationAgentReplies {
  private readonly dependencies: ConversationAgentRepliesDependencies;
  private readonly replies: ConversationReplyRunner;

  public constructor(dependencies: ConversationAgentRepliesDependencies) {
    this.dependencies = dependencies;
    this.replies = new ConversationReplyRunner(dependencies);
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

  /**
   * Ends the answers and routing decisions an earlier process left open,
   * without starting them again.
   *
   * @param startedAt - The start of this process.
   */
  public async recover(startedAt: Date): Promise<void> {
    const interrupted = await this.dependencies.rounds.interruptStale(
      startedAt.toISOString(),
    );
    if (interrupted > 0)
      logEvent({
        level: "info",
        event: "conversation.agent_reply.interrupted",
        component: COMPONENT,
        message: "Answers of agents an earlier process left open were ended.",
        metadata: { count: interrupted },
      });
  }

  /** The agents that are answering in a conversation now. */
  public workingAgentIds(conversationId: string): string[] {
    return this.replies.workingAgentIds(conversationId);
  }

  /**
   * The messages of a conversation whose answer waits, and why (PAGE-304).
   *
   * @returns By message ID; `limit` wins over `chat` when several agents wait.
   */
  public queuedMessages(
    conversationId: string,
  ): ReadonlyMap<string, AgentMessageQueue> {
    return this.replies.queuedMessages(conversationId);
  }

  /**
   * Stops the running answer of one agent in a conversation of the person;
   * other agents and other conversations answer on (PAGE-304).
   *
   * @returns Whether an answer was running and is stopped now.
   * @throws {ConversationError} `not_found` for a conversation the person is no member of.
   */
  public async stop(
    person: User,
    conversationId: string,
    agentId: string,
  ): Promise<boolean> {
    const conversation = await this.dependencies.conversations.findForMember(
      conversationId,
      person.id,
    );
    if (!conversation) throw new ConversationError("not_found");
    return this.replies.stop(conversationId, agentId);
  }

  /**
   * Starts the answers a message of a person asks for and returns once they
   * and their hand-overs ended.
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
    if (!sender || sender.user.isAgent === true) return;
    const conversation = await this.dependencies.conversations.findForMember(
      message.conversationId,
      sender.user.id,
    );
    if (!conversation) return;
    const round: ConversationRound = {
      originMessageId: message.id,
      conversation,
      memberIds,
      person: sender.user,
    };
    const base = {
      triggerMessageId: message.id,
      requestedBy: null,
      reason: "",
      isAutomatic: false,
    };
    if (conversation.kind === "direct") {
      const partners = memberIds.filter(
        (id) => id !== sender.user.id && isAgentMember(id, memberIds, accounts),
      );
      await this.dispatchAll(
        round,
        partners.map((agentId) => ({ ...base, agentId, trigger: "direct" })),
      );
      return;
    }
    const mentioned = [...new Set(message.mentions)].filter((id) =>
      isAgentMember(id, memberIds, accounts),
    );
    if (mentioned.length > 0) {
      await this.dispatchAll(
        round,
        mentioned.map((agentId) => ({ ...base, agentId, trigger: "mention" })),
      );
      return;
    }
    const settings = await this.dependencies.replySettings.find(
      conversation.id,
    );
    if (settings.mode === "mentions") return;
    if (settings.mode === "decision") {
      await this.decide(round, message, settings, accounts);
      return;
    }
    await this.route(round, { trigger: message, from: null }, accounts);
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

  private async dispatchAll(
    round: ConversationRound,
    requests: readonly ReplyRequest[],
  ): Promise<void> {
    await Promise.all(requests.map((request) => this.dispatch(round, request)));
  }

  /** Claims the answer of one agent in the round, runs it and follows its hand-over. */
  private async dispatch(
    round: ConversationRound,
    request: ReplyRequest,
  ): Promise<void> {
    const outcome = await this.dependencies.rounds.claim({
      originMessageId: round.originMessageId,
      conversationId: round.conversation.id,
      personId: round.person.id,
      createdAt: this.now(),
      ...request,
    });
    if (outcome !== "claimed") {
      if (outcome === "limit") this.logLimit(round, request.agentId);
      return;
    }
    const answer = await this.replies.run({
      round,
      agentId: request.agentId,
      trigger: request.trigger,
      triggerMessageId: request.triggerMessageId,
      reason: request.reason,
    });
    if (answer && round.conversation.kind === "group")
      await this.handOver(round, answer);
  }

  /**
   * Asks the decision model once for a message of a person and starts the
   * agents it settles on.
   */
  private async decide(
    round: ConversationRound,
    message: ConversationMessage,
    settings: ConversationReplySettings,
    accounts: ConversationAccounts,
  ): Promise<void> {
    const starts = await this.dependencies.decisions.decide({
      conversation: round.conversation,
      originMessageId: round.originMessageId,
      person: round.person,
      message,
      memberIds: round.memberIds,
      settings,
      accounts,
    });
    await this.dispatchAll(
      round,
      starts.map((start) => ({
        agentId: start.agentId,
        trigger: start.trigger,
        triggerMessageId: message.id,
        requestedBy: null,
        reason: start.reason,
        isAutomatic: true,
      })),
    );
  }

  /**
   * The agents an answer hands over to: those it mentions, or in `observer`
   * mode the observer's choice. An answer never starts a decision, and a long
   * run of agent messages without a person starts no hand-over (PAGE-317).
   */
  private async handOver(
    round: ConversationRound,
    answer: ConversationMessage,
  ): Promise<void> {
    const accounts = await this.dependencies.directory.read();
    if (await this.isAgentStreak(round, answer, accounts)) return;
    const mentioned = [...new Set(answer.mentions)].filter((id) =>
      isAgentMember(id, round.memberIds, accounts),
    );
    if (mentioned.length === 0) {
      const { mode } = await this.dependencies.replySettings.find(
        round.conversation.id,
      );
      if (mode !== "observer") return;
      await this.route(
        round,
        { trigger: answer, from: answer.sender },
        accounts,
      );
      return;
    }
    const reason = `${answer.sender.name} hat dich in einer Antwort mit @ angesprochen.`;
    await this.dispatchAll(
      round,
      mentioned.map((agentId) => ({
        agentId,
        trigger: "handoff",
        triggerMessageId: answer.id,
        requestedBy: answer.sender.id,
        reason,
        isAutomatic: true,
      })),
    );
  }

  /**
   * Asks the observer once whether further agents should answer, and starts
   * the chosen ones; nobody when it fails.
   */
  private async route(
    round: ConversationRound,
    judged: {
      readonly trigger: ConversationMessage;
      readonly from: ConversationMessage["sender"] | null;
    },
    accounts: ConversationAccounts,
  ): Promise<void> {
    const { rounds } = this.dependencies;
    const candidates = this.candidates(round, judged.trigger, accounts);
    if (candidates.length === 0) return;
    const state = await rounds.round(round.originMessageId);
    const asked = new Set(state?.agentIds ?? []);
    const open = candidates.filter((candidate) => !asked.has(candidate.id));
    const maximum =
      CONVERSATION_OBSERVER_LIMITS.automaticRepliesPerOrigin -
      (state?.automaticCount ?? 0);
    if (open.length === 0 || maximum <= 0) return;
    const isClaimed = await rounds.claimRouting({
      triggerMessageId: judged.trigger.id,
      origin: {
        originMessageId: round.originMessageId,
        conversationId: round.conversation.id,
        personId: round.person.id,
        createdAt: this.now(),
      },
    });
    if (!isClaimed) return;
    const choices = await this.choose(round, {
      ...judged,
      candidates: open,
      maximum,
      accounts,
    });
    if (choices === null) return;
    await this.dispatchAll(
      round,
      choices.map((choice) => ({
        agentId: choice.agentId,
        trigger: judged.from ? "handoff" : "context",
        triggerMessageId: judged.trigger.id,
        requestedBy: judged.from?.id ?? null,
        reason: choice.reason,
        isAutomatic: true,
      })),
    );
  }

  /** Calls the observer and stores its decision; `null` when it gave none. */
  private async choose(
    round: ConversationRound,
    judged: {
      readonly trigger: ConversationMessage;
      readonly from: ConversationMessage["sender"] | null;
      readonly candidates: readonly ObserverCandidate[];
      readonly maximum: number;
      readonly accounts: ConversationAccounts;
    },
  ): Promise<{ readonly agentId: string; readonly reason: string }[] | null> {
    const { rounds } = this.dependencies;
    try {
      const choices = await this.dependencies.routing.choose({
        conversation: round.conversation,
        triggerMessageId: judged.trigger.id,
        personId: round.person.id,
        candidates: judged.candidates,
        maximum: judged.maximum,
        handoff: judged.from
          ? {
              personName: round.person.displayName,
              agentName: judged.from.name,
            }
          : null,
        accounts: judged.accounts,
      });
      await rounds.finishRouting(judged.trigger.id, {
        state: choices.length > 0 ? "routed" : "silent",
        selection: choices,
        errorCode: null,
        finishedAt: this.now(),
      });
      return choices;
    } catch (error: unknown) {
      if (!(error instanceof ConversationObserverError))
        logCaughtError(COMPONENT, error);
      await rounds.finishRouting(judged.trigger.id, {
        state: "failed",
        selection: [],
        errorCode:
          error instanceof ConversationObserverError
            ? error.code
            : "observer_failed",
        finishedAt: this.now(),
      });
      return null;
    }
  }

  /** The active agent members the observer may choose: never the sender, never one without an account now. */
  private candidates(
    round: ConversationRound,
    judged: ConversationMessage,
    accounts: ConversationAccounts,
  ): ObserverCandidate[] {
    return round.memberIds
      .filter((id) => id !== judged.sender.id)
      .map((id) => accounts.find(id))
      .filter(
        (account): account is ConversationAccount =>
          account?.user.isAgent === true && account.isAvailable,
      )
      .map((account) => ({
        id: account.user.id,
        name: account.user.displayName,
        username: account.user.username,
        role: account.role,
      }));
  }

  /** Whether the newest messages up to the answer are all of agents, without a person between. */
  private async isAgentStreak(
    round: ConversationRound,
    answer: ConversationMessage,
    accounts: ConversationAccounts,
  ): Promise<boolean> {
    const { messages } = this.dependencies;
    const stored = await messages.find(round.conversation.id, answer.id);
    if (!stored) return false;
    const streak = CONVERSATION_DECISION_LIMITS.agentStreak;
    const newestFirst = await messages.history(
      round.conversation.id,
      stored.sequence + 1,
      streak,
    );
    const isStreak =
      newestFirst.length >= streak &&
      newestFirst.every(
        (message) => accounts.find(message.senderId)?.user.isAgent === true,
      );
    if (isStreak)
      logEvent({
        level: "info",
        event: "conversation.agent_reply.streak",
        component: COMPONENT,
        message:
          "Agent messages in a row without a person started no further hand-over.",
        metadata: { conversationId: round.conversation.id, streak },
      });
    return isStreak;
  }

  private logLimit(round: ConversationRound, agentId: string): void {
    logEvent({
      level: "info",
      event: "conversation.agent_reply.limit",
      component: COMPONENT,
      message:
        "The limit of automatic answers of a round held back a further answer.",
      metadata: { conversationId: round.conversation.id, agentId },
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

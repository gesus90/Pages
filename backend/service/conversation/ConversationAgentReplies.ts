import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { CONVERSATION_AGENT_SEND_PREFIX } from "@/definition/Conversation";
import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";

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
import type { ConversationAgentGuard } from "./ConversationAgentGuard";
import type { ConversationAgentFiles } from "./content/ConversationAgentFiles";
import type { ConversationAttachments } from "./content/ConversationAttachments";
import type { ConversationMessageContentReader } from "./content/ConversationMessageContent";
import type { ConversationContextReader } from "./ConversationContextReader";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type {
  ConversationEvent,
  ConversationEvents,
} from "./ConversationEvents";
import type { ConversationChatDecisions } from "./ConversationChatDecisions";
import type {
  ConversationReplyJob,
  ConversationRound,
} from "./ConversationReplyRunner";

const COMPONENT = "ConversationAgentReplies";

/** One answer an agent is asked for. */
export interface ConversationAgentRequest {
  readonly agent: User;
  /** The person, or the agent (PAGE-311), whose message opened the round the agent answers. */
  readonly person: User;
  readonly conversation: Pick<ConversationRecord, "id" | "kind" | "name">;
  /** The task with the limited context of the conversation. */
  readonly prompt: string;
  /** The text of the answered message alone. */
  readonly lastMessage: string;
  /**
   * The sequence of the answered message, the newest one this round carries;
   * the agent's session of the chat counts the messages up to it as received
   * once the round is delivered (PAGE-376).
   */
  readonly throughSequence?: number;
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
  /**
   * Hands the round to the answer the agent is giving in this conversation
   * now, instead of starting a second one (PAGE-376).
   *
   * @returns Whether the running answer took it; `false` when none runs or it
   * no longer takes messages, so the round waits for its own turn.
   */
  steer?(request: ConversationAgentRequest): Promise<boolean>;
  /**
   * The newest message of the conversation the agent's session received; `0`
   * before the first round (PAGE-376).
   */
  deliveredThrough?(agentId: string, conversationId: string): Promise<number>;
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
  /** How each group decides who answers without an @ (PAGE-317, PAGE-379). */
  readonly replySettings: Pick<ConversationReplySettingsRepository, "find">;
  /** The decision model that chooses agents for a group in decision mode (PAGE-379). */
  readonly decisions: Pick<
    ConversationChatDecisions,
    "decide" | "recordMention"
  >;
  /** The in-process channel: the replies follow it and publish to it. */
  readonly events: Pick<ConversationEvents, "subscribe" | "publish">;
  /** Tells the live view of this process about a change. */
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
  /** The attachments and links of a stored answer. */
  readonly content: ConversationMessageContentReader;
  readonly now?: () => Date;
  /** Waits for a busy agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
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

/** The message of a person, or one an agent chose to send, whose text is known now; `null` for every other change. */
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

function isAgentMember(
  id: string,
  memberIds: readonly string[],
  accounts: ConversationAccounts,
): boolean {
  return memberIds.includes(id) && accounts.find(id)?.user.isAgent === true;
}

/**
 * The answers of agents in conversations (PAGE-276, PAGE-296, PAGE-379).
 *
 * @remarks
 * In a direct conversation the agent answers every message of the person.
 * In a group a message that names members with @ wins: exactly the agents it
 * names answer at once, each once, and nobody is asked who should answer. A
 * message of a person without any @ follows the setting of the group: in
 * `mentions` mode nobody answers, in `decision` mode the decision model of the
 * instance is asked once and Pages answers with the thresholds of the group
 * (at most the configured number of agents); without a usable model the group
 * behaves like `mentions`. A message an agent sent without an @ asks nobody,
 * so agents wake each other only by naming each other: an answer that names
 * agents with @ hands the round over to them. Every answer stays in the round
 * of the person's message: each agent answers a round once at most, and the
 * decision model and the hand-overs add at most the automatic answers a round
 * allows. All of it is stored, so repeated events, concurrent jobs and a
 * restart start nothing twice. Agents start a round only with a message they
 * chose to send (PAGE-311); it asks exactly the agents it mentions, or the
 * partner of a direct conversation, and a conversation paused after a chain of
 * agent messages gets no answer.
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

  /** How many messages of a conversation wait for the answer of one agent (PAGE-376). */
  public queuedFor(conversationId: string, agentId: string): number {
    return this.replies.queuedFor(conversationId, agentId);
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
    if (!sender || !isAskingMessage(message)) return;
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
      await this.recordMention(round, message, mentioned);
      await this.dispatchAll(
        round,
        mentioned.map((agentId) => ({ ...base, agentId, trigger: "mention" })),
      );
      return;
    }
    // A message that names only people is addressed to them, and a message an
    // agent chose to send asks only the agents it mentions.
    if (message.mentions.length > 0 || sender.user.isAgent === true) return;
    const settings = await this.dependencies.replySettings.find(
      conversation.id,
    );
    if (settings.mode === "mentions") return;
    await this.decide(round, message, settings, accounts);
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
   * Stores that a person named agents with @ in a group of the decision mode,
   * so the list of decisions shows it; it never stops the answers.
   */
  private async recordMention(
    round: ConversationRound,
    message: ConversationMessage,
    agentIds: readonly string[],
  ): Promise<void> {
    if (round.person.isAgent === true) return;
    try {
      const { mode } = await this.dependencies.replySettings.find(
        round.conversation.id,
      );
      if (mode !== "decision") return;
      await this.dependencies.decisions.recordMention({
        conversationId: round.conversation.id,
        messageId: message.id,
        agentIds,
      });
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
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
   * The agents an answer hands over to: only those it mentions with @. An
   * answer never starts a decision, and a long run of agent messages without a
   * person starts no hand-over (PAGE-317, PAGE-379).
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
    if (mentioned.length === 0) return;
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

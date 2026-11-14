import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  CONVERSATION_OBSERVER_LIMITS,
  conversationRoundLimits,
} from "@/definition/ConversationObserver";

import {
  answerableMessage,
  isAskingMessage,
} from "./ConversationAnswerableMessage";
import { isAgentChainPaused } from "./ConversationAgentChain";
import { ConversationReplyRunner } from "./ConversationReplyRunner";
import { ConversationRoundFollowUps } from "./ConversationRoundFollowUps";

import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationRecord,
  ConversationRepository,
} from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import type { ConversationHandoffRequest } from "@/backend/database/repositories/conversation/ConversationHandoffRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { AgentMessageQueue } from "@/definition/AgentSessionLimits";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationReplySettings } from "@/definition/ConversationDecision";
import type { ConversationAttachment } from "@/definition/ConversationContent";
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

/** Context selected after the native session is known to be fresh or continued. */
export interface ConversationAgentTurn {
  readonly prompt: string;
  readonly attachments: readonly ConversationAttachment[];
  readonly throughSequence: number;
}

/** The most messages a resumed hand-over reads since the agent's last message. */
const RESUME_CONTEXT_MESSAGES = 50;

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
  readonly attachments?: readonly ConversationAttachment[];
  /**
   * Null starts with the bounded history; a cursor receives every later
   * message. A resumed agent session knows the chat up to the stored position
   * of its session and receives only what is newer (PAGE-376).
   */
  readonly prepareTurn?: (
    afterSequence: number | null,
    isResumed?: boolean,
  ) => Promise<ConversationAgentTurn>;
  /** Reads only an attachment of this conversation, with the agent's current membership. */
  readonly openAttachment?: (
    attachmentId: string,
  ) => Promise<AsyncIterable<Uint8Array>>;
  /**
   * The sequence of the answered message, the newest one this round carries;
   * the agent's session of the chat counts the messages up to it as received
   * once the round is delivered (PAGE-376).
   */
  readonly throughSequence?: number;
  /** Copies file attachments before the agent job removes its temporary workspace. */
  readonly consumeAnswer?: (answer: string) => Promise<void>;
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
  readonly conversations: Pick<
    ConversationRepository,
    "findForMember" | "memberIds"
  >;
  readonly messages: Pick<
    ConversationMessageRepository,
    "find" | "history" | "insert" | "contextCount"
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
    "stage" | "bind" | "release" | "open"
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
  readonly isFollowUp?: boolean;
  /** The stored @ hand-over the answer takes (PAGE-349). */
  readonly handoff?: "pending" | "paused";
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
 * agents with @ hands the round over to them, also to agents that answered in
 * the round before (PAGE-349). Every answer stays in the round of the
 * person's message. An agent starts at most once per message that asks it,
 * never for its own mention. Explicit @ hand-overs have no limit per round or
 * per agent; contributions without @ (decision model) share the group's
 * configured budget. Only the chain pause stops @ hand-overs: they are stored
 * and logged, nothing shows in the chat, and the next message of a person
 * starts each of them once. Replies to an agent's @ question are bundled into
 * one continuation. All of it is stored, so repeated events, concurrent jobs
 * and a restart start nothing twice. Agents start a round only with a message
 * they chose to send (PAGE-311); it asks exactly the agents it mentions, or
 * the partner of a direct conversation, and a conversation paused after a
 * chain of agent messages gets no answer.
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
  private readonly followUps: ConversationRoundFollowUps;

  public constructor(dependencies: ConversationAgentRepliesDependencies) {
    this.dependencies = dependencies;
    this.replies = new ConversationReplyRunner(dependencies);
    this.followUps = new ConversationRoundFollowUps(
      dependencies,
      async (round, start) => {
        await this.dispatch(round, {
          agentId: start.agentId,
          trigger: "handoff",
          triggerMessageId: start.questionMessageId,
          requestedBy: null,
          reason: start.reason,
          isAutomatic: false,
          isFollowUp: true,
        });
      },
    );
  }

  /**
   * Follows the committed messages of the process.
   *
   * @returns Stops following.
   */
  public start(): () => void {
    const unsubscribe = this.dependencies.events.subscribe((event) => {
      this.receive(event);
    });
    return () => {
      unsubscribe();
      this.followUps.stop();
    };
  }

  /**
   * Ends the answers and routing decisions an earlier process left open,
   * without starting them again.
   *
   * @param startedAt - The start of this process.
   */
  public async recover(startedAt: Date): Promise<void> {
    const { rounds } = this.dependencies;
    // First: hand-overs that never began are paused, not interrupted, so the next person resumes them.
    const paused = await rounds.handoffs.pauseUnstarted(
      startedAt.toISOString(),
    );
    for (const handoff of paused) this.logPaused(handoff, "restart");
    const interrupted = await rounds.interruptStale(startedAt.toISOString());
    await this.followUps.recover();
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
    // A message of a person ends the chain pause and starts what waited there (PAGE-349).
    const resumed =
      conversation.kind === "group" && sender.user.isAgent !== true
        ? this.resumePaused(conversation.id)
        : Promise.resolve();
    await Promise.all([this.answerRound(round, message, accounts), resumed]);
  }

  /** Starts the answers the message of a round asks for. */
  private async answerRound(
    round: ConversationRound,
    message: ConversationMessage,
    accounts: ConversationAccounts,
  ): Promise<void> {
    const { conversation, memberIds, person: sender } = round;
    const base = {
      triggerMessageId: message.id,
      requestedBy: null,
      reason: "",
      isAutomatic: false,
    };
    if (conversation.kind === "direct") {
      const partners = memberIds.filter(
        (id) => id !== sender.id && isAgentMember(id, memberIds, accounts),
      );
      await this.dispatchAll(
        round,
        partners.map((agentId) => ({ ...base, agentId, trigger: "direct" })),
      );
      return;
    }
    const mentioned = [...new Set(message.mentions)].filter(
      (id) => id !== sender.id && isAgentMember(id, memberIds, accounts),
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
    if (message.mentions.length > 0 || sender.isAgent === true) return;
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
    const settings = await this.dependencies.replySettings.find(
      round.conversation.id,
    );
    const outcome = await this.dependencies.rounds.claim({
      originMessageId: round.originMessageId,
      conversationId: round.conversation.id,
      personId: round.person.id,
      createdAt: this.now(),
      ...request,
      reason: Array.from(request.reason)
        .slice(0, CONVERSATION_OBSERVER_LIMITS.routingReasonCharacters)
        .join(""),
      limits: conversationRoundLimits(settings),
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
      isFollowUp: request.isFollowUp,
      contextMessageIds: await this.contextOf(round, request),
    });
    if (round.conversation.kind === "group" && answer)
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
   * The messages a continuation reads besides the history: a batch gets the
   * round replies since its question, a resumed hand-over every message since
   * the agent's last one. Both are read after the claim, so nothing bundled
   * meanwhile is missing.
   */
  private async contextOf(
    round: ConversationRound,
    request: ReplyRequest,
  ): Promise<readonly string[] | undefined> {
    if (request.isFollowUp)
      return this.dependencies.rounds.followUps.context(
        round.originMessageId,
        request.triggerMessageId,
      );
    if (request.handoff !== "paused") return undefined;
    const newestFirst = await this.dependencies.messages.history(
      round.conversation.id,
      null,
      RESUME_CONTEXT_MESSAGES,
    );
    const since = [];
    for (const message of newestFirst) {
      if (message.senderId === request.agentId) break;
      if (message.notice === null) since.push(message.id);
    }
    return since.reverse();
  }

  /**
   * Starts the hand-overs of a group that waited at the chain pause or across
   * a restart, each exactly once: the claim takes the stored request.
   */
  private async resumePaused(conversationId: string): Promise<void> {
    const { rounds } = this.dependencies;
    const paused = await rounds.handoffs.paused(conversationId);
    await Promise.all([
      this.followUps.resume(conversationId),
      ...paused.map(async (handoff) => {
        const state = await rounds.round(handoff.originMessageId);
        const round = state
          ? await this.followUps.restore({
              originMessageId: handoff.originMessageId,
              conversationId,
              personId: state.personId,
            })
          : null;
        if (!round) return;
        await this.dispatch(round, {
          agentId: handoff.agentId,
          trigger: "handoff",
          triggerMessageId: handoff.triggerMessageId,
          requestedBy: handoff.requestedBy,
          reason: handoff.reason,
          isAutomatic: false,
          handoff: "paused",
        });
      }),
    ]);
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
   * The agents an answer hands over to: every other agent member it mentions
   * with @, also one that answered in the round before. An answer never starts
   * a decision. At the chain pause an @ hand-over is stored and logged instead
   * of started (PAGE-349, PAGE-379).
   */
  private async handOver(
    round: ConversationRound,
    answer: ConversationMessage,
  ): Promise<void> {
    const accounts = await this.dependencies.directory.read();
    const isPaused = await isAgentChainPaused(
      this.dependencies.messages,
      accounts,
      round.conversation.id,
    );
    const mentioned = [...new Set(answer.mentions)].filter(
      (id) =>
        id !== answer.sender.id && isAgentMember(id, round.memberIds, accounts),
    );
    if (mentioned.length === 0) return;
    // A reply to an agent's own question joins its batch instead of starting it separately.
    const bundled = await this.followUps.observe(round, answer, mentioned);
    const reason = `${answer.sender.name} hat dich in einer Antwort mit @ angesprochen.`;
    const handoffs = mentioned
      .filter((agentId) => !bundled.has(agentId))
      .map((agentId) => ({
        triggerMessageId: answer.id,
        agentId,
        originMessageId: round.originMessageId,
        conversationId: round.conversation.id,
        personId: round.person.id,
        requestedBy: answer.sender.id,
        reason,
        state: isPaused ? ("paused" as const) : ("pending" as const),
        pauseReason: isPaused ? ("agent_streak" as const) : null,
        createdAt: this.now(),
      }));
    const stored = await this.dependencies.rounds.handoffs.request(handoffs);
    if (isPaused) {
      for (const handoff of stored) this.logPaused(handoff, "agent_streak");
      return;
    }
    await this.dispatchAll(
      round,
      handoffs.map((handoff) => ({
        agentId: handoff.agentId,
        trigger: "handoff",
        triggerMessageId: answer.id,
        requestedBy: answer.sender.id,
        reason,
        isAutomatic: false,
        handoff: "pending",
      })),
    );
  }

  /** A stored @ hand-over waits for a message of a person; nothing shows in the chat. */
  private logPaused(
    handoff: ConversationHandoffRequest,
    reason: "agent_streak" | "restart",
  ): void {
    logEvent({
      level: "info",
      event: "conversation.agent_reply.paused",
      component: COMPONENT,
      message: "A hand-over with @ was stored and waits until a person writes.",
      metadata: {
        conversationId: handoff.conversationId,
        agentId: handoff.agentId,
        triggerMessageId: handoff.triggerMessageId,
        reason,
      },
    });
  }

  private logLimit(round: ConversationRound, agentId: string): void {
    logEvent({
      level: "info",
      event: "conversation.agent_reply.limit",
      component: COMPONENT,
      message:
        "The limit of contributions without @ of a round held back a further answer.",
      metadata: { conversationId: round.conversation.id, agentId },
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

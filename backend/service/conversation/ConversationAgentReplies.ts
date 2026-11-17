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
import { reopenFailedAnswer } from "./ConversationAnswerRetry";
import {
  logPausedHandoff,
  logRoundLimit,
  logStartFailure,
  logUnanswerable,
} from "./ConversationReplyLogs";
import { ConversationReplyRunner } from "./ConversationReplyRunner";
import { ConversationRoundFollowUps } from "./ConversationRoundFollowUps";
import { chosenDelivery, mentionDelivery } from "./ConversationDeliveryIntents";

import type { LiveAnswerSink } from "./ConversationLiveAnswer";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type { ConversationDeliveryIntent } from "@/definition/ConversationRecipientDelivery";
import type { ConversationAnswerStreamPort } from "./ConversationReplyTypes";
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
import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { User } from "@/definition/User";
import type { ConversationAgentGuard } from "./ConversationAgentGuard";
import type { ConversationAgentFiles } from "./content/ConversationAgentFiles";
import type { ConversationAttachmentReferences } from "./content/ConversationAttachmentReferences";
import type { ConversationAttachments } from "./content/ConversationAttachments";
import type { ConversationGeneratedImages } from "./content/ConversationGeneratedImages";
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
  /** The person, or the agent, whose message opened the round the agent answers. */
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
   * of its session and receives only what is newer.
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
   * once the round is delivered.
   */
  readonly throughSequence?: number;
  /** Copies file attachments before the agent job removes its temporary workspace. */
  readonly consumeAnswer?: (answer: string) => Promise<void>;
  /** Stops the answer, also while it waits for a free place. */
  readonly signal?: AbortSignal;
  /** Called when the answer waits because the limits of concurrent sessions are reached. */
  readonly onQueued?: () => void;
  /** Called when the answer got its place and begins. */
  readonly onAdmitted?: () => void;
  /** Shows the answer to the members while it is written. */
  readonly liveAnswer?: LiveAnswerSink;
}

/**
 * Runs one answer of an agent with its own model, instructions and rights,
 * or in the simulation.
 * @remarks
 * It refuses with an {@link AgentEmployeeError}: `inactive` for a
 * deactivated agent, `unavailable` where no model can run it.
 */
export interface ConversationAgentRunner {
  answer(request: ConversationAgentRequest): Promise<string>;
  /**
   * Hands the round to the answer the agent is giving in this conversation
   * now, instead of starting a second one.
   * @returns Whether the running answer took it; `false` when none runs or it
   * no longer takes messages, so the round waits for its own turn.
   */
  steer?(request: ConversationAgentRequest): Promise<boolean>;
  /**
   * The newest message of the conversation the agent's session received; `0`
   * before the first round.
   */
  deliveredThrough?(agentId: string, conversationId: string): Promise<number>;
  /**
   * Cancels the running tool calls of the agent's answer in the conversation.
   * @returns Whether a running call was cancelled.
   */
  cancelTool?(agentId: string, conversationId: string): Promise<boolean>;
}

/** What the answers of agents in conversations use. */
export interface ConversationAgentRepliesDependencies {
  readonly conversations: Pick<
    ConversationRepository,
    "findForMember" | "memberIds"
  >;
  readonly messages: Pick<
    ConversationMessageRepository,
    | "find"
    | "findById"
    | "history"
    | "insert"
    | "contextCount"
    | "removeFailureNotice"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly runner: ConversationAgentRunner;
  /** The stored rounds, asked agents and routing decisions. */
  readonly rounds: ConversationRoundRepository;
  /** The stored context of groups, for the prompt of an answer. */
  readonly contexts: Pick<ConversationContextReader, "promptContext">;
  /** How each group decides who answers without an @. */
  readonly replySettings: Pick<ConversationReplySettingsRepository, "find">;
  /** The decision model that chooses agents for a group in decision mode. */
  readonly decisions: Pick<
    ConversationChatDecisions,
    "decide" | "recordMention"
  >;
  /** The in-process channel: the replies follow it and publish to it. */
  readonly events: Pick<ConversationEvents, "subscribe" | "publish">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  /** Pauses a chain of agent messages; without it no chain is limited. */
  readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  /** Reads the file lines of an answer. */
  readonly agentFiles: Pick<ConversationAgentFiles, "select" | "open">;
  /** Reads the lines of an answer that show earlier attachments of the chat again; absent shows none. */
  readonly references?: Pick<
    ConversationAttachmentReferences,
    "select" | "bind"
  >;
  /** Stores the files an answer attaches and binds them to it. */
  readonly attachments: Pick<
    ConversationAttachments,
    "stage" | "bind" | "release" | "open"
  >;
  /** The attachments and links of a stored answer. */
  readonly content: ConversationMessageContentReader;
  /** The images the agent generated during the answer; absent binds none. */
  readonly generatedImages?: Pick<ConversationGeneratedImages, "take">;
  readonly now?: () => Date;
  /** Waits for a busy agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
  /** Shows the answers to the members while they are written; absent shows none. */
  readonly answerStream?: ConversationAnswerStreamPort;
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
  /** The stored @ hand-over the answer takes. */
  readonly handoff?: "pending" | "paused";
  /** How the message of a person reaches this agent; absent leaves it untracked. */
  readonly deliveryIntent?: ConversationDeliveryIntent;
}

function isAgentMember(
  id: string,
  memberIds: readonly string[],
  accounts: ConversationAccounts,
): boolean {
  return memberIds.includes(id) && accounts.find(id)?.user.isAgent === true;
}

/**
 * The answers of agents in conversations.
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
 * the round before. Every answer stays in the round of the
 * person's message. An agent starts at most once per message that asks it,
 * never for its own mention. Explicit @ hand-overs have no limit per round or
 * per agent; contributions without @ (decision model) share the group's
 * configured budget. Only the chain pause stops @ hand-overs: they are stored
 * and logged, nothing shows in the chat, and the next message of a person
 * starts each of them once. Replies to an agent's @ question are bundled into
 * one continuation. All of it is stored, so repeated events, concurrent jobs
 * and a restart start nothing twice. Agents start a round only with a message
 * they chose to send; it asks exactly the agents it mentions, or
 * the partner of a direct conversation, and a conversation paused after a
 * chain of agent messages gets no answer.
 * Every agent answers in its own session of the conversation, so
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
   * @param startedAt - The start of this process.
   */
  public async recover(startedAt: Date): Promise<void> {
    const { rounds } = this.dependencies;
    // First: hand-overs that never began are paused, not interrupted, so the next person resumes them.
    const paused = await rounds.handoffs.pauseUnstarted(
      startedAt.toISOString(),
    );
    for (const handoff of paused) logPausedHandoff(handoff, "restart");
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
   * The messages of a conversation whose answer waits, and why.
   * @returns By message ID; `limit` wins over `chat` when several agents wait.
   */
  public queuedMessages(
    conversationId: string,
  ): ReadonlyMap<string, AgentMessageQueue> {
    return this.replies.queuedMessages(conversationId);
  }

  /** The messages of a conversation handed to running answers, with their agents. */
  public steeredMessages(
    conversationId: string,
  ): ReadonlyMap<string, readonly string[]> {
    return this.replies.steeredMessages(conversationId);
  }

  /** How many messages of a conversation wait for the answer of one agent. */
  public queuedFor(conversationId: string, agentId: string): number {
    return this.replies.queuedFor(conversationId, agentId);
  }

  /**
   * Stops the running answer of one agent in a conversation of the person;
   * other agents and other conversations answer on.
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
   * Cancels the running tool calls of one agent's answer in a conversation of
   * the person; the answer goes on with what it has.
   * @returns Whether a running call was cancelled.
   * @throws {ConversationError} `not_found` for a conversation the person is no member of.
   */
  public async cancelTool(
    person: User,
    conversationId: string,
    agentId: string,
  ): Promise<boolean> {
    const conversation = await this.dependencies.conversations.findForMember(
      conversationId,
      person.id,
    );
    if (!conversation) throw new ConversationError("not_found");
    return (
      (await this.dependencies.runner.cancelTool?.(agentId, conversationId)) ??
      false
    );
  }

  /**
   * Starts the failed answer of an agent once more on a member's request;
   * its hint goes and the answer runs in the background.
   * @returns Whether the answer starts again; `false` when it already did.
   * @throws {ConversationError} `not_found` for a message that is no hint of
   * a failed answer in a conversation of the person.
   */
  public async retry(person: User, messageId: string): Promise<boolean> {
    const job = await reopenFailedAnswer(
      { ...this.dependencies, followUps: this.followUps },
      { person, messageId, now: this.now() },
    );
    if (!job) return false;
    void withBackgroundDatabaseWork("conversation_agent_reply", async () => {
      const answer = await this.replies.run(job);
      if (job.round.conversation.kind === "group" && answer)
        await this.handOver(job.round, answer);
    }).catch((error: unknown) => logCaughtError(COMPONENT, error));
    return true;
  }

  /**
   * Starts the answers a message of a person asks for and returns once they
   * and their hand-overs ended.
   * @param message - A committed message.
   * @param memberIds - The members of its conversation.
   */
  public async answer(
    message: ConversationMessage,
    memberIds: readonly string[],
    delivery?: ConversationDelivery,
  ): Promise<void> {
    if (!isAskingMessage(message)) return;
    const accounts = await this.dependencies.directory.read();
    const sender = accounts.find(message.sender.id);
    const conversation = sender
      ? await this.dependencies.conversations.findForMember(
          message.conversationId,
          sender.user.id,
        )
      : null;
    if (!sender || !conversation) {
      logUnanswerable(message, sender ? "no_membership" : "no_sender");
      return;
    }
    const round: ConversationRound = {
      originMessageId: message.id,
      conversation,
      memberIds,
      person: sender.user,
    };
    // A message of a person ends the chain pause and starts what waited there.
    const resumed =
      conversation.kind === "group" && sender.user.isAgent !== true
        ? this.resumePaused(conversation.id)
        : Promise.resolve();
    await Promise.all([
      this.deliver(round, message, { accounts, delivery }),
      resumed,
    ]);
  }

  /**
   * Routes a message of a person and says per recipient how it reaches the
   * agent.
   * @remarks
   * In a direct conversation "after" waits until the answering agent ended
   * and every other message goes into its running answer, as before. In a
   * group the routing chooses the recipients as for any message; that agents
   * answer elsewhere never steers it. An agent named with @ gets the message
   * into its running answer, or as a new task when it is free; an agent the
   * decision model chose gets a new task, which waits behind its running
   * answer; "after" waits behind the running answer of each recipient alone,
   * so a free recipient starts at once. Only a deliberate "steer" without an
   * @ goes into the answers of every agent answering now.
   */
  private async deliver(
    round: ConversationRound,
    message: ConversationMessage,
    options: {
      readonly accounts: ConversationAccounts;
      readonly delivery: ConversationDelivery | undefined;
    },
  ): Promise<void> {
    const { accounts, delivery } = options;
    const { conversation, memberIds, person } = round;
    const working = this.replies
      .workingAgentIds(conversation.id)
      .filter(
        (id) => id !== person.id && isAgentMember(id, memberIds, accounts),
      );
    if (conversation.kind === "direct") {
      if (delivery === "after" && working.length > 0)
        await this.replies.holdUntilIdle(conversation.id, message.id, working);
      await this.answerRound(round, message, { accounts });
      return;
    }
    const isUnaddressed = message.mentions.length === 0;
    if (delivery === "steer" && isUnaddressed && working.length > 0) {
      await this.dispatchAll(
        round,
        working.map((agentId) => ({
          agentId,
          trigger: "mention",
          triggerMessageId: message.id,
          requestedBy: null,
          reason: "",
          isAutomatic: false,
          deliveryIntent: "steer",
        })),
      );
      return;
    }
    await this.answerRound(round, message, { accounts, delivery });
  }

  /**
   * Starts the answers the message of a round asks for; in a group each
   * recipient gets the delivery its way of being chosen allows.
   */
  private async answerRound(
    round: ConversationRound,
    message: ConversationMessage,
    routing: {
      readonly accounts: ConversationAccounts;
      readonly delivery?: ConversationDelivery;
    },
  ): Promise<void> {
    const { accounts, delivery } = routing;
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
      const deliveryIntent = mentionDelivery(delivery);
      await this.dispatchAll(
        round,
        mentioned.map((agentId) => ({
          ...base,
          agentId,
          trigger: "mention",
          deliveryIntent,
        })),
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
    await this.decide(round, message, {
      settings,
      accounts,
      deliveryIntent: chosenDelivery(delivery),
    });
  }

  private receive(event: ConversationEvent): void {
    const message = answerableMessage(event);
    if (!message) return;
    const delivery = event.kind === "message" ? event.delivery : undefined;
    void withBackgroundDatabaseWork("conversation_agent_reply", () =>
      this.answer(message, event.recipientIds, delivery),
    ).catch((error: unknown) => {
      logStartFailure(message, error);
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
      if (outcome === "limit") logRoundLimit(round, request.agentId);
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
      ...(request.deliveryIntent === undefined
        ? {}
        : { delivery: request.deliveryIntent }),
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
   * agents it settles on; being chosen never steers a running answer.
   */
  private async decide(
    round: ConversationRound,
    message: ConversationMessage,
    options: {
      readonly settings: ConversationReplySettings;
      readonly accounts: ConversationAccounts;
      readonly deliveryIntent: ConversationDeliveryIntent;
    },
  ): Promise<void> {
    const { settings, accounts, deliveryIntent } = options;
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
        deliveryIntent,
      })),
    );
  }

  /**
   * The agents an answer hands over to: every other agent member it mentions
   * with @, also one that answered in the round before. An answer never starts
   * a decision. At the chain pause an @ hand-over is stored and logged instead
   * of started.
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
      for (const handoff of stored) logPausedHandoff(handoff, "agent_streak");
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

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

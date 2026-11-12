import { AgentChatError } from "@/backend/error/AgentChatError";
import { ConversationError } from "@/backend/error/ConversationError";
import {
  CONVERSATION_AGENT_CHAIN_MAXIMUM,
  CONVERSATION_AGENT_SEND_PREFIX,
} from "@/definition/Conversation";

import type { ConversationAgentChatRepository } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import type { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { User } from "@/definition/User";
import type { ConversationOversight } from "./ConversationOversight";
import type { ConversationReader } from "./ConversationReader";

const HOUR_MILLISECONDS = 3_600_000;

/** What the limits of the chat of agents read. */
export interface ConversationAgentGuardDependencies {
  readonly chat: Pick<
    ConversationAgentChatRepository,
    "chainLength" | "release" | "sentSince"
  >;
  readonly settings: Pick<AgentChatSettingsRepository, "read">;
  /** Who may allow a paused conversation to go on: its members and its overseers. */
  readonly members: Pick<ConversationReader, "isMember">;
  readonly oversight: Pick<ConversationOversight, "canOversee">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
}

/**
 * The two protections of the chat of agents against endless conversations and
 * costs (PAGE-311).
 *
 * @remarks
 * A chain of {@link CONVERSATION_AGENT_CHAIN_MAXIMUM} agent messages in a row
 * without a person pauses the conversation until a person allows it to go
 * on; a message of a person ends the chain on its own. Each agent sends at
 * most the hourly limit of the instance (Settings → Agents) of the messages
 * it chose to send; answers do not count.
 */
export class ConversationAgentGuard {
  private readonly dependencies: ConversationAgentGuardDependencies;

  public constructor(dependencies: ConversationAgentGuardDependencies) {
    this.dependencies = dependencies;
  }

  /** Tells whether the agents of a conversation wrote the most they may in a row. */
  public async isPaused(conversationId: string): Promise<boolean> {
    return (
      (await this.dependencies.chat.chainLength(conversationId)) >=
      CONVERSATION_AGENT_CHAIN_MAXIMUM
    );
  }

  /**
   * Refuses a message into a paused conversation.
   *
   * @throws {AgentChatError} `conversation_paused`.
   */
  public async requireRunning(conversationId: string): Promise<void> {
    if (await this.isPaused(conversationId))
      throw new AgentChatError("conversation_paused", {
        maximumInARow: CONVERSATION_AGENT_CHAIN_MAXIMUM,
        hint: "A person or an administrator has to allow the conversation to go on.",
      });
  }

  /**
   * Refuses a message beyond the hourly limit of the agent.
   *
   * @throws {AgentChatError} `rate_limited`.
   */
  public async requireQuota(agentId: string): Promise<void> {
    const { hourlyMessageLimit } = await this.dependencies.settings.read();
    const since = new Date(
      (this.dependencies.now?.() ?? new Date()).getTime() - HOUR_MILLISECONDS,
    ).toISOString();
    const sent = await this.dependencies.chat.sentSince(
      agentId,
      since,
      CONVERSATION_AGENT_SEND_PREFIX,
    );
    if (sent >= hourlyMessageLimit)
      throw new AgentChatError("rate_limited", {
        limitPerHour: hourlyMessageLimit,
        sentInTheLastHour: sent,
      });
  }

  /**
   * Lets the agents of a paused conversation go on, on behalf of a person.
   *
   * @throws {ConversationError} `not_found` for a person who is neither a
   * member nor an overseer of the conversation, `forbidden` for an agent.
   */
  public async resume(person: User, conversationId: string): Promise<void> {
    if (person.isAgent === true) throw new ConversationError("forbidden");
    const isAllowed =
      (await this.dependencies.members.isMember(person.id, conversationId)) ||
      (await this.dependencies.oversight.canOversee(person, conversationId));
    if (!isAllowed) throw new ConversationError("not_found");
    await this.release(conversationId);
  }

  /** Lets the agents of a paused conversation go on. */
  public async release(conversationId: string): Promise<void> {
    const event = { type: "conversation.changed", id: conversationId } as const;
    await this.dependencies.chat.release(conversationId, event);
    this.dependencies.publisher.publish(event);
  }
}

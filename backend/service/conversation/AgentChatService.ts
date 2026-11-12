import { randomUUID } from "node:crypto";

import { AgentChatError } from "@/backend/error/AgentChatError";
import { ConversationError } from "@/backend/error/ConversationError";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import {
  CONVERSATION_AGENT_SEND_PREFIX,
  CONVERSATION_NAME_MAXIMUM_LENGTH,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";

import { AgentChatReplyWatch } from "./AgentChatReplyWatch";

import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  AgentChatEntry,
  AgentChatListPage,
  AgentChatMessage,
  AgentChatParticipant,
  AgentChatReachability,
  AgentChatReadPage,
  AgentChatSendRequest,
  AgentChatSendResult,
  AgentChatTarget,
  AgentChatTools,
} from "@/definition/AgentChat";
import type {
  ConversationMessage,
  ConversationParticipant,
  ConversationSummary,
} from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type { ConversationAccounts } from "./ConversationDirectory";
import type { ConversationAgentGuard } from "./ConversationAgentGuard";
import type { ConversationDirectory } from "./ConversationDirectory";
import type { ConversationEvents } from "./ConversationEvents";
import type { ConversationReader } from "./ConversationReader";
import type { ConversationService } from "./ConversationService";

/** Characters of a message text that `chats_list` shows of the last message. */
const PREVIEW_CHARACTERS = 300;

/** What the Pages tools of the chat of agents use. */
export interface AgentChatServiceDependencies {
  readonly users: Pick<UserRepository, "findById">;
  readonly groups: Pick<UserGroupRepository, "findAll">;
  readonly conversations: Pick<ConversationRepository, "findDirect">;
  readonly reader: Pick<ConversationReader, "list" | "history" | "summary">;
  readonly service: Pick<
    ConversationService,
    "send" | "openDirect" | "adoptGroup" | "markRead"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly guard: Pick<
    ConversationAgentGuard,
    "isPaused" | "requireRunning" | "requireQuota"
  >;
  /** The in-process channel the replies of agents come through. */
  readonly events: Pick<ConversationEvents, "subscribe">;
  readonly createId?: () => string;
}

function participant(entry: ConversationParticipant): AgentChatParticipant {
  return { id: entry.id, name: entry.name, kind: entry.kind };
}

function toMessage(message: ConversationMessage): AgentChatMessage {
  return {
    id: message.id,
    sender: participant(message.sender),
    text: message.text,
    createdAt: message.createdAt,
    ...(message.notice === undefined ? {} : { notice: message.notice }),
  };
}

function preview(message: ConversationMessage): AgentChatMessage {
  const text = Array.from(message.text);
  return {
    ...toMessage(message),
    text:
      text.length > PREVIEW_CHARACTERS
        ? `${text.slice(0, PREVIEW_CHARACTERS).join("")}…`
        : message.text,
  };
}

function readText(input: string): string {
  const text = input.trim();
  if (text === "" || Array.from(text).length > CONVERSATION_TEXT_MAXIMUM_LENGTH)
    throw new AgentChatError("invalid_message", {
      maximumCharacters: CONVERSATION_TEXT_MAXIMUM_LENGTH,
    });
  if (redactCredentials(text) !== text)
    throw new AgentChatError("credentials_in_message");
  return text;
}

/** The agents among the members that the message asks for an answer. */
function addressedAgentIds(
  message: ConversationMessage,
  summary: ConversationSummary,
  accounts: ConversationAccounts,
): string[] {
  const candidates =
    summary.kind === "direct"
      ? summary.members.map(({ id }) => id)
      : message.mentions;
  return [...new Set(candidates)].filter(
    (id) =>
      id !== message.sender.id && accounts.find(id)?.user.isAgent === true,
  );
}

/**
 * The reads and sends of agents in conversations, behind the Pages tools
 * `chats_list`, `chat_read` and `chat_send` (PAGE-311).
 *
 * @remarks
 * It reuses the stored conversations of people, agents and groups. An agent
 * reads only chats it is a member of and writes to those, or to a person,
 * agent or user group it may assign tickets to; the tool layer answers the
 * latter from `assignment_targets_search`. A direct chat or the group chat
 * of a user group is created on first use. A message to an agent is answered
 * as if a person had written it (see {@link ConversationAgentReplies}). A
 * chain of agent messages and the hourly limit stop runaway conversations.
 * Credential-like text is refused. Everything an agent triggers by its
 * message stays checked against the rights of the agent that answers.
 */
export class AgentChatService implements AgentChatTools {
  private readonly dependencies: AgentChatServiceDependencies;

  public constructor(dependencies: AgentChatServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Lists the chats the agent takes part in, the latest activity first.
   *
   * @throws {AgentChatError} `agent_unavailable`, `invalid_request` for a malformed cursor.
   */
  public async list(
    agentId: string,
    input: { readonly cursor: string | null },
  ): Promise<AgentChatListPage> {
    const agent = await this.requireAgent(agentId);
    const page = await this.translate(() =>
      this.dependencies.reader.list(agent, input.cursor),
    );
    const chats = await Promise.all(
      page.items.map((summary) => this.entry(summary)),
    );
    return {
      chats,
      nextCursor: page.nextCursor,
      totalUnread: page.totalUnread,
    };
  }

  /**
   * Reads a page of a chat of the agent and marks the newest page as read.
   *
   * @throws {AgentChatError} `chat_not_found` for a chat the agent is no
   * member of, `invalid_request` for a message outside it.
   */
  public async read(
    agentId: string,
    input: { readonly chatId: string; readonly beforeMessageId: string | null },
  ): Promise<AgentChatReadPage> {
    const agent = await this.requireAgent(agentId);
    const page = await this.translate(() =>
      this.dependencies.reader.history(
        agent,
        input.chatId,
        input.beforeMessageId,
      ),
    );
    const newest = page.messages.at(-1);
    if (newest && input.beforeMessageId === null)
      await this.translate(() =>
        this.dependencies.service.markRead(agent, {
          conversationId: input.chatId,
          upToMessageId: newest.id,
        }),
      );
    return {
      chatId: page.conversationId,
      messages: page.messages.map(toMessage),
      hasMore: page.hasMore,
      isPaused: await this.dependencies.guard.isPaused(page.conversationId),
    };
  }

  /**
   * Sends a message to a chat of the agent or to a target, and may wait for
   * the reply of the agent that is asked.
   *
   * @throws {AgentChatError} `invalid_request`, `invalid_message`,
   * `credentials_in_message`, `chat_not_found`, `forbidden_target`,
   * `conversation_paused`, `rate_limited` or `agent_unavailable`.
   */
  public async send(
    agentId: string,
    request: AgentChatSendRequest,
    context: {
      readonly reachability: AgentChatReachability;
      readonly signal: AbortSignal;
    },
  ): Promise<AgentChatSendResult> {
    const agent = await this.requireAgent(agentId);
    const text = readText(request.text);
    const accounts = await this.dependencies.directory.read();
    const chatId = await this.resolveChat(agent, request, {
      accounts,
      reachability: context.reachability,
    });
    await this.dependencies.guard.requireRunning(chatId);
    await this.dependencies.guard.requireQuota(agent.id);
    const watch = request.waitForReply
      ? new AgentChatReplyWatch(this.dependencies.events, chatId)
      : null;
    try {
      const message = await this.translate(() =>
        this.dependencies.service.send(agent, {
          conversationId: chatId,
          clientMessageId: `${CONVERSATION_AGENT_SEND_PREFIX}${this.createId()}`,
          text,
        }),
      );
      return await this.outcome(agent, { message, watch }, request, context);
    } finally {
      watch?.close();
    }
  }

  private async outcome(
    agent: User,
    sent: {
      readonly message: ConversationMessage;
      readonly watch: AgentChatReplyWatch | null;
    },
    request: AgentChatSendRequest,
    context: { readonly signal: AbortSignal },
  ): Promise<AgentChatSendResult> {
    const { message, watch } = sent;
    const base = { chatId: message.conversationId, messageId: message.id };
    if (await this.dependencies.guard.isPaused(message.conversationId))
      return { ...base, status: "paused" };
    if (!watch) return { ...base, status: "sent" };
    const [summary, accounts] = await Promise.all([
      this.dependencies.reader.summary(agent, message.conversationId),
      this.dependencies.directory.read(),
    ]);
    if (addressedAgentIds(message, summary, accounts).length === 0)
      return { ...base, status: "sent" };
    const reply = await watch.next(message.id, {
      milliseconds: request.timeoutSeconds * 1_000,
      signal: context.signal,
    });
    return reply
      ? { ...base, status: "replied", reply: toMessage(reply) }
      : { ...base, status: "pending" };
  }

  /** The conversation the message goes to: the named chat, or the direct or group chat with the target. */
  private async resolveChat(
    agent: User,
    request: AgentChatSendRequest,
    context: {
      readonly accounts: ConversationAccounts;
      readonly reachability: AgentChatReachability;
    },
  ): Promise<string> {
    const { chatId, target } = request;
    if ((chatId === undefined) === (target === undefined))
      throw new AgentChatError("invalid_request", {
        hint: "Name exactly one of chatId and target.",
      });
    if (chatId !== undefined) {
      const summary = await this.translate(() =>
        this.dependencies.reader.summary(agent, chatId),
      );
      return summary.id;
    }
    if (target === undefined) throw new AgentChatError("invalid_request");
    return target.type === "group"
      ? this.groupChat(agent, target, context)
      : this.directChat(agent, target, context);
  }

  private async directChat(
    agent: User,
    target: AgentChatTarget,
    context: {
      readonly accounts: ConversationAccounts;
      readonly reachability: AgentChatReachability;
    },
  ): Promise<string> {
    const account = context.accounts.find(target.id);
    const isAgent = account?.user.isAgent === true;
    if (
      !account ||
      target.id === agent.id ||
      isAgent !== (target.type === "agent")
    )
      throw new AgentChatError("invalid_request", {
        hint: "The target is unknown, the agent itself, or of another type.",
      });
    const key = [agent.id, target.id].sort().join(":");
    const existing = await this.dependencies.conversations.findDirect(key);
    if (existing === null) {
      const isReachable = await context.reachability.canReach({
        type: "person",
        id: target.id,
        name: account.user.displayName,
      });
      if (!isReachable) throw new AgentChatError("forbidden_target");
    }
    const summary = await this.translate(() =>
      this.dependencies.service.openDirect(agent, target.id),
    );
    return summary.id;
  }

  /** The chat of one agent with a user group; its members are those of the group. */
  private async groupChat(
    agent: User,
    target: AgentChatTarget,
    context: { readonly reachability: AgentChatReachability },
  ): Promise<string> {
    const group = (await this.dependencies.groups.findAll()).find(
      ({ id }) => id === target.id,
    );
    const id = `usergroup-${target.id}-${agent.id}`;
    if (!group || !/^[a-zA-Z0-9-]{1,100}$/u.test(id))
      throw new AgentChatError("forbidden_target");
    const isReachable = await context.reachability.canReach({
      type: "group",
      id: group.id,
      name: group.name,
    });
    if (!isReachable) throw new AgentChatError("forbidden_target");
    const name = Array.from(`${agent.displayName} → ${group.name}`)
      .slice(0, CONVERSATION_NAME_MAXIMUM_LENGTH)
      .join("");
    await this.translate(() =>
      this.dependencies.service.adoptGroup(agent, {
        id,
        name,
        memberIds: group.memberIds,
      }),
    );
    return id;
  }

  private async entry(summary: ConversationSummary): Promise<AgentChatEntry> {
    const { lastMessage } = summary;
    return {
      id: summary.id,
      kind: summary.kind,
      name: summary.name,
      participants: summary.members.map(participant),
      lastMessage: lastMessage ? preview(lastMessage) : null,
      unreadCount: summary.unreadCount,
      // Only a chat whose newest message an agent wrote can have used up its chain.
      isPaused:
        lastMessage?.sender.kind === "agent" &&
        (await this.dependencies.guard.isPaused(summary.id)),
      lastActivityAt: summary.lastActivityAt,
    };
  }

  private async requireAgent(agentId: string): Promise<User> {
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true || !agent.isActive)
      throw new AgentChatError("agent_unavailable");
    return agent;
  }

  /** Turns a refusal of the conversations into the one the agent understands. */
  private async translate<Result>(run: () => Promise<Result>): Promise<Result> {
    try {
      return await run();
    } catch (error: unknown) {
      if (!(error instanceof ConversationError)) throw error;
      if (error.code === "not_found")
        throw new AgentChatError("chat_not_found");
      if (error.code === "forbidden")
        throw new AgentChatError("forbidden_target");
      throw new AgentChatError("invalid_request");
    }
  }

  private createId(): string {
    return this.dependencies.createId?.() ?? randomUUID();
  }
}

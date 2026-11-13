import { AgentChatError } from "@/backend/error/AgentChatError";
import { ConversationError } from "@/backend/error/ConversationError";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type {
  AgentChatEntry,
  AgentChatListPage,
  AgentChatSendRequest,
  AgentChatSendResult,
  AgentChatTools,
} from "@/definition/AgentChat";

/** The chat a session belongs to, as far as the chat tools care. */
export interface AgentChatToolScope {
  readonly agentId: string;
  /** The conversation of a group session; `null` for the direct chat with a person. */
  readonly conversationId: string | null;
}

/** What the guard reads. */
export interface AgentChatToolGuardDependencies {
  readonly store: EmployeeStore;
}

/**
 * Keeps the content of a confidential chat inside its own session (PAGE-376).
 *
 * @remarks
 * Every chat has its own session. The chat tools of an agent could read other
 * chats it takes part in, so a session would learn what a confidential chat
 * holds. The guard binds the tools to one session: a confidential chat other
 * than the session's own reads as a chat that does not exist, shows no last
 * message in the list, and a message sent to it returns no reply. The same
 * goes for the stored context of a group.
 */
export class AgentChatToolGuard {
  private readonly dependencies: AgentChatToolGuardDependencies;

  public constructor(dependencies: AgentChatToolGuardDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The chat tools of one session.
   *
   * @param tools - The tools of the agent.
   * @param scope - The chat of the session.
   */
  public tools(
    tools: AgentChatTools,
    scope: AgentChatToolScope,
  ): AgentChatTools {
    return {
      list: async (agentId, input) =>
        this.hideContent(await tools.list(agentId, input), scope),
      read: async (agentId, input) => {
        await this.requireReadable(input.chatId, scope);
        return tools.read(agentId, input);
      },
      send: async (agentId, request, context) =>
        this.send(tools, agentId, request, { ...context, scope }),
    };
  }

  /**
   * The reader of the stored context of a group, bound to one session.
   *
   * @param read - The reader of the agent.
   * @param scope - The chat of the session.
   * @throws {ConversationError} `not_found` for another confidential chat.
   */
  public contextReader(
    read: (input: unknown) => Promise<unknown>,
    scope: AgentChatToolScope,
  ): (input: unknown) => Promise<unknown> {
    return async (input) => {
      const conversationId =
        typeof input === "object" && input !== null
          ? Reflect.get(input, "conversationId")
          : undefined;
      if (
        typeof conversationId === "string" &&
        (await this.isForeignConfidential(conversationId, scope))
      )
        throw new ConversationError("not_found");
      return read(input);
    };
  }

  private async isForeignConfidential(
    conversationId: string,
    scope: AgentChatToolScope,
  ): Promise<boolean> {
    if (conversationId === scope.conversationId) return false;
    return this.dependencies.store
      .chats()
      .isConfidentialConversation(scope.agentId, conversationId);
  }

  private async requireReadable(
    chatId: string,
    scope: AgentChatToolScope,
  ): Promise<void> {
    if (await this.isForeignConfidential(chatId, scope))
      throw new AgentChatError("chat_not_found");
  }

  /** Takes the last message out of the entries of confidential chats of other sessions. */
  private async hideContent(
    page: AgentChatListPage,
    scope: AgentChatToolScope,
  ): Promise<AgentChatListPage> {
    const chats: AgentChatEntry[] = [];
    for (const chat of page.chats)
      chats.push(
        chat.lastMessage !== null &&
          (await this.isForeignConfidential(chat.id, scope))
          ? { ...chat, lastMessage: null }
          : chat,
      );
    return { ...page, chats };
  }

  /** Sends a message; into a confidential chat of another session without waiting for, or returning, a reply. */
  private async send(
    tools: AgentChatTools,
    agentId: string,
    request: AgentChatSendRequest,
    context: Parameters<AgentChatTools["send"]>[2] & {
      readonly scope: AgentChatToolScope;
    },
  ): Promise<AgentChatSendResult> {
    const { scope, ...rest } = context;
    const isKnownForeign =
      request.chatId !== undefined &&
      (await this.isForeignConfidential(request.chatId, scope));
    const result = await tools.send(
      agentId,
      isKnownForeign ? { ...request, waitForReply: false } : request,
      rest,
    );
    if (
      result.reply !== undefined &&
      (await this.isForeignConfidential(result.chatId, scope))
    )
      return {
        chatId: result.chatId,
        messageId: result.messageId,
        status: "sent",
      };
    return result;
  }
}

/**
 * Contracts of the Pages tools with which agents read chats and send
 * messages (PAGE-311).
 *
 * @remarks
 * `chats_list`, `chat_read` and `chat_send` work on the stored conversations
 * of people, agents and groups. An agent reads and writes only chats it takes
 * part in, and starts one only with those it may assign tickets to.
 */

import type {
  ConversationNotice,
  ConversationParticipantKind,
} from "./Conversation";

/** A sender or participant as the tools name them. */
export interface AgentChatParticipant {
  readonly id: string;
  readonly name: string;
  readonly kind: ConversationParticipantKind;
}

/** A message as `chat_read` and `chats_list` return it. */
export interface AgentChatMessage {
  readonly id: string;
  readonly sender: AgentChatParticipant;
  readonly text: string;
  /** ISO 8601 moment the message was stored. */
  readonly createdAt: string;
  /** Present for a hint of Pages why an agent did not answer. */
  readonly notice?: ConversationNotice;
}

/** One chat of `chats_list`. */
export interface AgentChatEntry {
  readonly id: string;
  readonly kind: "direct" | "group";
  readonly name: string;
  readonly participants: readonly AgentChatParticipant[];
  readonly lastMessage: AgentChatMessage | null;
  readonly unreadCount: number;
  /** Agents may not write on: a chain of agent messages is used up and a person has to allow it. */
  readonly isPaused: boolean;
  readonly lastActivityAt: string;
}

/** One page of `chats_list`. */
export interface AgentChatListPage {
  readonly chats: readonly AgentChatEntry[];
  readonly nextCursor: string | null;
  readonly totalUnread: number;
}

/** One page of `chat_read`: oldest first. */
export interface AgentChatReadPage {
  readonly chatId: string;
  readonly messages: readonly AgentChatMessage[];
  /** Whether older messages exist; read them with the ID of the first message as `beforeMessageId`. */
  readonly hasMore: boolean;
  readonly isPaused: boolean;
}

/** Whom a message is written to. */
export interface AgentChatTarget {
  readonly type: "person" | "agent" | "group";
  readonly id: string;
}

/** The request of `chat_send`: an existing chat or a target, exactly one. */
export interface AgentChatSendRequest {
  readonly chatId?: string | undefined;
  readonly target?: AgentChatTarget | undefined;
  readonly text: string;
  readonly waitForReply: boolean;
  /** How long to wait for the reply, in seconds. */
  readonly timeoutSeconds: number;
}

/** How a sent message stands. */
export type AgentChatSendStatus = "sent" | "replied" | "pending" | "paused";

/** The result of `chat_send`. */
export interface AgentChatSendResult {
  readonly chatId: string;
  readonly messageId: string;
  /**
   * `sent` without waiting or when nobody is asked to answer, `replied` with
   * the reply, `pending` when no reply came within the time (it appears in the
   * chat later), `paused` when the chain of agent messages ended the chat.
   */
  readonly status: AgentChatSendStatus;
  readonly reply?: AgentChatMessage;
}

/** Checks whether the agent may write to a person or group; the Pages tool layer answers it from `assignment_targets_search`. */
export interface AgentChatReachability {
  canReach(target: {
    readonly type: "person" | "group";
    readonly id: string;
    readonly name: string;
  }): Promise<boolean>;
}

/** What the Pages tools of the chat of agents call. */
export interface AgentChatTools {
  list(
    agentId: string,
    input: { readonly cursor: string | null },
  ): Promise<AgentChatListPage>;
  read(
    agentId: string,
    input: { readonly chatId: string; readonly beforeMessageId: string | null },
  ): Promise<AgentChatReadPage>;
  send(
    agentId: string,
    request: AgentChatSendRequest,
    context: {
      readonly reachability: AgentChatReachability;
      readonly signal: AbortSignal;
    },
  ): Promise<AgentChatSendResult>;
}

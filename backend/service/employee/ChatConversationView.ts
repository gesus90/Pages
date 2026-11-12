import { CONVERSATION_AGENT_SEND_PREFIX } from "@/definition/Conversation";

import type { ConversationView } from "@/backend/service/conversation/ConversationReader";
import type {
  ConversationMessage,
  ConversationParticipant,
} from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type {
  VirtualChatMessage,
  VirtualGroup,
} from "@/definition/VirtualChat";

/** The address the chat page plays the audio of a voice message from. */
export function conversationVoiceUrl(messageId: string): string {
  return `/chat/voice/${encodeURIComponent(messageId)}`;
}

/**
 * Turns a stored conversation message into a message of the chat page.
 *
 * @param message - The stored message.
 * @param person - The signed-in person; their own messages carry no author.
 * @returns The message with its author and, for a voice message, its audio.
 */
export function toVirtualMessage(
  message: ConversationMessage,
  person: User,
): VirtualChatMessage {
  const isOwn = message.sender.id === person.id;
  const base: VirtualChatMessage = {
    id: message.id,
    authorId: isOwn ? null : message.sender.id,
    content: message.text,
    createdAt: message.createdAt,
    mentions: message.mentions,
    toolUses: [],
    author: {
      name: message.sender.name,
      kind: message.sender.kind,
      color: message.sender.color,
    },
    ...(message.notice ? { notice: message.notice } : {}),
    ...(message.decision ? { decision: message.decision } : {}),
  };
  if (!message.voice) return base;
  return {
    ...base,
    voice: {
      url: conversationVoiceUrl(message.id),
      durationMs: message.voice.durationMs,
      transcriptionState: message.voice.transcriptionState,
    },
  };
}

/** The stored conversations of a person, split by what the chat page shows them as. */
export interface ChatConversations {
  /** Direct conversations with people, by the other participant. */
  readonly direct: ReadonlyMap<string, ConversationView>;
  /** Groups, by their ID, which is the ID of a group of the page as well. */
  readonly groups: ReadonlyMap<string, ConversationView>;
}

/**
 * Splits the person's conversations into direct ones with people and groups.
 *
 * @param views - Every conversation of the person.
 * @param person - The signed-in person.
 * @returns The conversations the page shows; direct ones with agents stay out,
 * because an agent's history on the page is its chat session.
 */
export function splitConversations(
  views: readonly ConversationView[],
  person: User,
): ChatConversations {
  const direct = new Map<string, ConversationView>();
  const groups = new Map<string, ConversationView>();
  for (const view of views) {
    if (view.summary.kind === "group") {
      groups.set(view.summary.id, view);
      continue;
    }
    const other = view.summary.members.find(
      (member: ConversationParticipant) => member.id !== person.id,
    );
    if (other?.kind === "human") direct.set(other.id, view);
  }
  return { direct, groups };
}

/**
 * The messages an agent chose to write to the person (PAGE-311), by agent.
 *
 * @param views - Every conversation of the person.
 * @param person - The signed-in person.
 * @returns The direct conversations with agents that hold such a message. The
 * page shows these messages with the agent's chat session, which stays the
 * history of what the person and the agent wrote to each other there.
 */
export function agentWrittenConversations(
  views: readonly ConversationView[],
  person: User,
): ReadonlyMap<string, ConversationView> {
  const written = new Map<string, ConversationView>();
  for (const view of views) {
    if (view.summary.kind !== "direct") continue;
    const other = view.summary.members.find(
      (member: ConversationParticipant) => member.id !== person.id,
    );
    if (other?.kind !== "agent") continue;
    if (view.messages.some((message) => isAgentWritten(message, other.id)))
      written.set(other.id, view);
  }
  return written;
}

/** Whether the agent chose to write the message (PAGE-311), instead of answering one. */
export function isAgentWritten(
  message: ConversationMessage,
  agentId: string,
): boolean {
  return (
    message.sender.id === agentId &&
    message.clientMessageId.startsWith(CONVERSATION_AGENT_SEND_PREFIX)
  );
}

/**
 * A shared group of which the person is a member without owning it on the page.
 *
 * @param view - The group conversation.
 * @param person - The signed-in person.
 * @returns The group as the page lists it.
 */
export function sharedGroup(
  view: ConversationView,
  person: User,
): VirtualGroup {
  return {
    id: view.summary.id,
    name: view.summary.name,
    description: "",
    memberIds: view.summary.members
      .map((member) => member.id)
      .filter((id) => id !== person.id),
    unreadCount: view.summary.unreadCount,
    isMuted: view.summary.isMuted,
    lastActivityAt: view.summary.lastActivityAt,
  };
}

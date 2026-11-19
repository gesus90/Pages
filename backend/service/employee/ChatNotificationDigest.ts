import { CHAT_NOTIFICATION_PREVIEW_CHARACTERS } from "@/definition/ChatNotificationDigest";

import { isShownWithAgentChat } from "./ChatConversationView";
import {
  avatarImage,
  messageInstant,
  withConversationPartners,
} from "./ChatDirectoryView";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  ConversationReader,
  ConversationView,
} from "@/backend/service/conversation/ConversationReader";
import type {
  ChatNotificationDigest,
  ChatNotificationEntry,
  ChatNotificationMessage,
} from "@/definition/ChatNotificationDigest";
import type { ConversationMessage } from "@/definition/Conversation";
import type { User } from "@/definition/User";

/** What the notification digest reads. */
export interface ChatNotificationDigestDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findAll">;
  readonly messages: Pick<ChatSessionRepository, "newestMessages">;
  readonly conversations: Pick<ConversationReader, "views">;
}

/** The direct conversations of the person, by the other participant. */
interface DirectConversations {
  readonly people: Map<string, ConversationView>;
  readonly agents: Map<string, ConversationView>;
}

function preview(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, CHAT_NOTIFICATION_PREVIEW_CHARACTERS);
}

/** A stored time as ISO 8601, so the browser compares times of both stores alike. */
function isoTime(createdAt: string): string {
  const instant = messageInstant(createdAt);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : createdAt;
}

function fromConversation(
  message: ConversationMessage | null,
  person: User,
): ChatNotificationMessage | null {
  if (!message) return null;
  const isOwn = message.sender.id === person.id;
  return {
    id: message.id,
    authorId: isOwn ? null : message.sender.id,
    author: isOwn
      ? null
      : { name: message.sender.name, kind: message.sender.kind },
    createdAt: isoTime(message.createdAt),
    preview: preview(message.text),
    isVoice: message.voice !== undefined,
    isNotice: message.notice !== undefined,
  };
}

/** The later of two messages; the first one on equal or unreadable times. */
function newer(
  first: ChatNotificationMessage | null,
  second: ChatNotificationMessage | null,
): ChatNotificationMessage | null {
  if (!first || !second) return first ?? second;
  return Date.parse(second.createdAt) > Date.parse(first.createdAt)
    ? second
    : first;
}

function splitDirect(
  views: readonly ConversationView[],
  person: User,
): DirectConversations {
  const people = new Map<string, ConversationView>();
  const agents = new Map<string, ConversationView>();
  for (const view of views) {
    if (view.summary.kind !== "direct") continue;
    const other = view.summary.members.find(
      (member) => member.id !== person.id,
    );
    if (other?.kind === "human") people.set(other.id, view);
    // An agent joins the list only once it wrote into the conversation.
    if (other?.kind === "agent" && view.summary.lastMessage)
      agents.set(other.id, view);
  }
  return { people, agents };
}

/**
 * The chats of a person with their newest message only, for the
 * notifications of the web interface.
 * @remarks
 * The same chats as the chat page: the person's own list, everybody who has
 * a direct conversation with the person, and the groups the person is a
 * member of. Conversations of agents only that the person merely oversees
 * announce nothing. No history and no answer details are read: a stored
 * conversation names its newest message in its summary, and a chat session
 * with an agent reads its newest message alone.
 */
export class ChatNotificationDigestReader {
  private readonly dependencies: ChatNotificationDigestDependencies;

  public constructor(dependencies: ChatNotificationDigestDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the digest of the person. */
  public async read(person: User): Promise<ChatNotificationDigest> {
    const [users, contacts, ownGroups, views] = await Promise.all([
      this.dependencies.users.findAll(),
      this.dependencies.store.contacts().list(person.id),
      this.dependencies.store.groups().list(person.id),
      this.dependencies.conversations.views(person, {
        withMessages: () => false,
      }),
    ]);
    const accounts = new Map(
      users
        .filter((user) => user.id !== person.id)
        .map((user) => [user.id, user]),
    );
    const direct = splitDirect(views, person);
    const partners = withConversationPartners(contacts, [
      ...direct.people,
      ...direct.agents,
    ]);
    const participants = await Promise.all(
      partners.flatMap((contact) => {
        const user = accounts.get(contact.contactId);
        return user ? [this.participantEntry(person, user, direct)] : [];
      }),
    );
    const groupNames = new Map(
      ownGroups.map((group) => [group.id, group.name] as const),
    );
    const groups = views
      .filter((view) => view.summary.kind === "group")
      .map((view): ChatNotificationEntry => ({
        chat: { kind: "group", id: view.summary.id },
        name: groupNames.get(view.summary.id) ?? view.summary.name,
        avatarImageUrl: null,
        isMuted: view.summary.isMuted,
        conversationId: view.summary.id,
        unreadCount: view.summary.unreadCount,
        latest: fromConversation(view.summary.lastMessage, person),
      }));
    return {
      entries: [...participants, ...groups],
    };
  }

  private async participantEntry(
    person: User,
    user: User,
    direct: DirectConversations,
  ): Promise<ChatNotificationEntry> {
    const base = {
      chat: { kind: "participant", id: user.id } as const,
      name: user.displayName,
      avatarImageUrl: avatarImage(user),
    };
    if (user.isAgent !== true) {
      const view = direct.people.get(user.id);
      return {
        ...base,
        isMuted: view?.summary.isMuted ?? false,
        conversationId: view?.summary.id ?? null,
        unreadCount: view?.summary.unreadCount ?? 0,
        latest: fromConversation(view?.summary.lastMessage ?? null, person),
      };
    }
    return this.agentEntry(person, user, direct, base);
  }

  /** The entry of an agent: its chat session, and the newest written message. */
  private async agentEntry(
    person: User,
    user: User,
    direct: DirectConversations,
    base: Pick<ChatNotificationEntry, "chat" | "name" | "avatarImageUrl">,
  ): Promise<ChatNotificationEntry> {
    const agentChat = direct.agents.get(user.id);
    const written = agentChat?.summary.lastMessage ?? null;
    return {
      ...base,
      isMuted: false,
      conversationId: null,
      unreadCount: agentChat?.summary.unreadCount ?? 0,
      latest: newer(
        await this.newestSessionMessage(person, user),
        written && isShownWithAgentChat(written, user.id)
          ? fromConversation(written, person)
          : null,
      ),
    };
  }

  /** The newest message of the person's chat session with an agent. */
  private async newestSessionMessage(
    person: User,
    agent: User,
  ): Promise<ChatNotificationMessage | null> {
    const conversation = await this.dependencies.store
      .conversations()
      .find(agent.id, person.id, "chat");
    if (!conversation) return null;
    const [message] = await this.dependencies.messages.newestMessages(
      conversation.sessionId,
      1,
    );
    if (!message) return null;
    const isOwn = message.role === "user";
    return {
      id: message.id,
      authorId: isOwn ? null : agent.id,
      author: isOwn ? null : { name: agent.displayName, kind: "agent" },
      createdAt: isoTime(message.createdAt),
      preview: preview(message.content),
      isVoice: false,
      isNotice: false,
    };
  }
}

import { sharedGroup, toVirtualMessage } from "./ChatConversationView";

import type { ChatContactEntry } from "@/backend/database/repositories/employee/ChatContactRepository";
import type { ChatGroupRecord } from "@/backend/database/repositories/employee/ChatGroupRepository";
import type { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import type { ConversationView } from "@/backend/service/conversation/ConversationReader";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualContactChoice,
  VirtualGroup,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";
import type { ChatConversations } from "./ChatConversationView";

/** The facts of one account the page shows. */
export interface AccountFacts {
  readonly user: User;
  /** The job title of an agent; empty for a person. */
  readonly jobTitle: string;
  /** Whether the account is among the active accounts a list can take. */
  readonly isChoosable: boolean;
}

/** The person's history with an agent and what its newest job does now. */
export interface AgentHistory {
  readonly messages: readonly VirtualChatMessage[];
  readonly isWorking: boolean;
  /** The tool calls of the answer in progress (PAGE-303). */
  readonly liveTools: readonly VirtualToolUse[];
  readonly accessLevel: AgentEmployeeAccess | undefined;
  /** The session of the agent in this chat (PAGE-376); absent before the first message. */
  readonly session?: AgentChatSessionBrief | undefined;
}

/** The uploaded avatar image URL of a user, or `null` when absent. */
export function avatarImage(user: User): string | null {
  return user.avatarType === "image" ? (user.avatarImageUrl ?? null) : null;
}

/** Marks the agents that nothing is shared from (PAGE-305). */
export function withConfidentiality(
  participants: VirtualChatDirectory["participants"],
  confidentialAgents: { has(id: string): boolean },
): VirtualChatDirectory["participants"] {
  return participants.map((participant) =>
    participant.kind === "agent"
      ? {
          ...participant,
          isConfidential: confidentialAgents.has(participant.id),
        }
      : participant,
  );
}

/** Builds one selectable contact choice for group creation or contact editing. */
export function contactChoice(facts: AccountFacts): VirtualContactChoice {
  const { user } = facts;
  const isAgent = user.isAgent === true;
  return {
    id: user.id,
    name: user.displayName,
    kind: isAgent ? "agent" : "human",
    subtitle: isAgent ? facts.jobTitle : user.username,
    color: user.avatarColor ?? null,
    avatarImageUrl: avatarImage(user),
    isSelectable: facts.isChoosable,
  };
}

/** The later of two ISO times; the second may be missing. */
export function latestActivityTime(
  first: string,
  second: string | undefined,
): string {
  return second !== undefined && second > first ? second : first;
}

function groupView(
  record: ChatGroupRecord,
  shownIds: ReadonlySet<string>,
  view: ConversationView | undefined,
): VirtualGroup {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    memberIds: record.memberIds.filter((id) => shownIds.has(id)),
    unreadCount: view?.summary.unreadCount ?? 0,
    isMuted: view?.summary.isMuted ?? false,
    lastActivityAt: latestActivityTime(
      record.lastActivityAt,
      view?.summary.lastActivityAt,
    ),
  };
}

/** The groups of the page: the person's own and the shared ones they belong to. */
export function groupsOfDirectory(
  records: readonly ChatGroupRecord[],
  shownIds: ReadonlySet<string>,
  conversations: ChatConversations,
  person: User,
): VirtualGroup[] {
  const ownIds = new Set(records.map((record) => record.id));
  return [
    ...records.map((record) =>
      groupView(record, shownIds, conversations.groups.get(record.id)),
    ),
    ...[...conversations.groups.values()]
      .filter((view) => !ownIds.has(view.summary.id))
      .map((view) => sharedGroup(view, person)),
  ];
}

/** What a participant shows of the stored direct conversation with them, if any. */
export function conversationState(
  view: ConversationView | undefined,
): Pick<VirtualParticipant, "unreadCount" | "isMuted" | "conversationId"> {
  return {
    unreadCount: view?.summary.unreadCount ?? 0,
    isMuted: view?.summary.isMuted ?? false,
    conversationId: view?.summary.id ?? null,
  };
}

/** The entries of the page whose stored history holds older messages (PAGE-275). */
export function olderHistoryIds(conversations: ChatConversations): string[] {
  return [...conversations.direct, ...conversations.groups]
    .filter(([, view]) => view.hasMore)
    .map(([id]) => id);
}

/** What a participant shows of the messages its agent wrote to the person (PAGE-311). */
export function agentWrittenState(
  view: ConversationView,
): Pick<VirtualParticipant, "unreadCount" | "agentChat"> {
  const newest = view.messages.at(-1);
  return {
    unreadCount: view.summary.unreadCount,
    agentChat: {
      conversationId: view.summary.id,
      newestMessageId: newest?.id ?? "",
    },
  };
}

/** Two histories as one, oldest first; the messages of the first stay before equal times. */
export function mergeByTime(
  first: readonly VirtualChatMessage[],
  second: readonly VirtualChatMessage[],
): VirtualChatMessage[] {
  return [...first, ...second].sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? ""),
  );
}

/** The person's list with everybody who has a direct conversation with them. */
export function withConversationPartners(
  contacts: readonly ChatContactEntry[],
  conversations: readonly (readonly [string, ConversationView])[],
): ChatContactEntry[] {
  const listed = new Set(contacts.map((contact) => contact.contactId));
  const partners = conversations
    .filter(([partnerId]) => !listed.has(partnerId))
    .map(([partnerId, view]) => ({
      contactId: partnerId,
      lastActivityAt: view.summary.lastActivityAt,
    }));
  return [...contacts, ...partners];
}

/** Converts one stored conversation view into chronological chat messages for the person. */
export function conversationHistory(
  view: ConversationView,
  person: User,
): VirtualChatMessage[] {
  return view.messages.map((message) => toVirtualMessage(message, person));
}

/** Builds one virtual chat participant entry from account facts, contact entry, and live state. */
export function directoryParticipant(
  facts: AccountFacts,
  contact: ChatContactEntry,
  state: {
    readonly isWorking: boolean;
    readonly view: ConversationView | undefined;
    readonly accessLevel?: AgentEmployeeAccess;
    /** The direct conversation in which the agent wrote to the person (PAGE-311). */
    readonly agentChat?: ConversationView | undefined;
    /** The session of the agent in the direct chat (PAGE-376). */
    readonly session?: AgentChatSessionBrief | undefined;
  },
): VirtualParticipant {
  const { user } = facts;
  const { view, agentChat } = state;
  const isAgent = user.isAgent === true;
  let status: VirtualParticipant["status"] = user.isActive ? "active" : "off";
  if (user.isActive && state.isWorking) status = "working";

  return {
    id: user.id,
    name: user.displayName,
    kind: isAgent ? "agent" : "human",
    role: isAgent ? facts.jobTitle : "",
    username: user.username,
    color: user.avatarColor ?? null,
    avatarImageUrl: avatarImage(user),
    status,
    ...conversationState(view),
    ...(agentChat ? agentWrittenState(agentChat) : {}),
    canChat: user.isActive && (isAgent || facts.isChoosable),
    lastActivityAt: latestActivityTime(
      contact.lastActivityAt,
      view?.summary.lastActivityAt,
    ),
    ...(state.accessLevel ? { accessLevel: state.accessLevel } : {}),
    ...(state.session ? { session: state.session } : {}),
  };
}

/** Adds the card of each question of an agent to the message that carries it (PAGE-391). */
export async function addConversationQuestions(
  questions: Pick<AgentChatQuestionService, "views"> | undefined,
  person: User,
  histories: Readonly<Record<string, readonly VirtualChatMessage[]>>,
): Promise<Record<string, readonly VirtualChatMessage[]>> {
  if (!questions) return { ...histories };
  const ids = Object.values(histories).flatMap((messages) =>
    messages.map((message) => message.id),
  );
  const views = await questions.views(person, ids);
  if (views.size === 0) return { ...histories };
  return Object.fromEntries(
    Object.entries(histories).map(([id, messages]) => [
      id,
      messages.map((message) => {
        const question = views.get(message.id);
        return question ? { ...message, question } : message;
      }),
    ]),
  );
}

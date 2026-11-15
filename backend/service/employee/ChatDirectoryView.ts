import { sharedGroup, toVirtualMessage } from "./ChatConversationView";

import type { ChatContactEntry } from "@/backend/database/repositories/employee/ChatContactRepository";
import type { ChatGroupRecord } from "@/backend/database/repositories/employee/ChatGroupRepository";
import type { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import type { ConversationAgentGuard } from "@/backend/service/conversation/ConversationAgentGuard";
import type { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
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

/** The state needed to build one participant entry of the chat directory. */
export interface ParticipantState {
  readonly isWorking: boolean;
  readonly view: ConversationView | undefined;
  readonly accessLevel?: AgentEmployeeAccess;
  /** The direct conversation in which the agent wrote to the person (PAGE-311). */
  readonly agentChat?: ConversationView | undefined;
  /** The session of the agent in the direct chat (PAGE-376). */
  readonly session?: AgentChatSessionBrief | undefined;
}

function avatarImage(user: User): string | null {
  return user.avatarType === "image" ? (user.avatarImageUrl ?? null) : null;
}

/** The later of two ISO times; the second may be missing. */
function latest(first: string, second: string | undefined): string {
  return second !== undefined && second > first ? second : first;
}

function groupEntry(
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
    lastActivityAt: latest(record.lastActivityAt, view?.summary.lastActivityAt),
  };
}

/** What a participant shows of the stored direct conversation with them, if any. */
function conversationState(
  view: ConversationView | undefined,
): Pick<VirtualParticipant, "unreadCount" | "isMuted" | "conversationId"> {
  return {
    unreadCount: view?.summary.unreadCount ?? 0,
    isMuted: view?.summary.isMuted ?? false,
    conversationId: view?.summary.id ?? null,
  };
}

/** What a participant shows of the messages its agent wrote to the person (PAGE-311). */
function agentWrittenState(
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

/** Builds one selectable contact choice entry for the chat directory. */
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

/** The groups of the page: the person's own and the shared ones they belong to. */
export function groupsOf(
  records: readonly ChatGroupRecord[],
  shownIds: ReadonlySet<string>,
  conversations: ChatConversations,
  person: User,
): VirtualGroup[] {
  const ownIds = new Set(records.map((record) => record.id));
  return [
    ...records.map((record) =>
      groupEntry(record, shownIds, conversations.groups.get(record.id)),
    ),
    ...[...conversations.groups.values()]
      .filter((view) => !ownIds.has(view.summary.id))
      .map((view) => sharedGroup(view, person)),
  ];
}

/** The entries of the page whose stored history holds older messages (PAGE-275). */
export function olderHistoryIds(conversations: ChatConversations): string[] {
  return [...conversations.direct, ...conversations.groups]
    .filter(([, view]) => view.hasMore)
    .map(([id]) => id);
}

/** Builds the view entry of one participant in the chat directory. */
export function participantView(
  facts: AccountFacts,
  contact: ChatContactEntry,
  state: ParticipantState,
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
    lastActivityAt: latest(
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

/** The conversations of agents only the person reads as an administrator or leader, shown as read-only groups. */
export async function overseenGroupConversations(
  sources: {
    readonly oversight?: Pick<ConversationOversight, "views">;
    readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  },
  person: User,
  accounts: ReadonlyMap<string, AccountFacts>,
): Promise<{
  readonly groups: VirtualGroup[];
  readonly histories: Record<string, readonly VirtualChatMessage[]>;
  readonly olderHistoryIds: string[];
}> {
  const groups: VirtualGroup[] = [];
  const histories: Record<string, readonly VirtualChatMessage[]> = {};
  const olderIds: string[] = [];
  const result = { groups, histories, olderHistoryIds: olderIds };
  const { oversight, guard } = sources;
  if (!oversight) return result;
  for (const view of await oversight.views(person)) {
    const { summary } = view;
    const members = summary.members.flatMap(({ id }) => {
      const facts = accounts.get(id);
      return facts
        ? [
            participantView(
              facts,
              { contactId: id, lastActivityAt: summary.lastActivityAt },
              { isWorking: false, view: undefined },
            ),
          ]
        : [];
    });
    result.groups.push({
      id: summary.id,
      name:
        summary.kind === "group"
          ? summary.name
          : members.map((member) => member.name).join(" ↔ "),
      description: "",
      memberIds: members.map((member) => member.id),
      unreadCount: 0,
      lastActivityAt: summary.lastActivityAt,
      isAgentConversation: true,
      agentMembers: members,
      ...((await guard?.isPaused(summary.id)) === true
        ? { isAgentPaused: true }
        : {}),
    });
    result.histories[summary.id] = view.messages.map((message) =>
      toVirtualMessage(message, person),
    );
    if (view.hasMore) result.olderHistoryIds.push(summary.id);
  }
  return result;
}

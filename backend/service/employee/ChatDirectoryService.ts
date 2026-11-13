import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";

import {
  agentWrittenConversations,
  isAgentWritten,
  sharedGroup,
  splitConversations,
  toVirtualMessage,
} from "./ChatConversationView";
import {
  markQueuedMessages,
  queuedChatMessages,
  waitingInChat,
} from "./ChatMessageQueues";

import type { ChatContactEntry } from "@/backend/database/repositories/employee/ChatContactRepository";
import type { ChatGroupRecord } from "@/backend/database/repositories/employee/ChatGroupRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ConversationAgentGuard } from "@/backend/service/conversation/ConversationAgentGuard";
import type { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
import type {
  ConversationHistoryOptions,
  ConversationReader,
  ConversationView,
} from "@/backend/service/conversation/ConversationReader";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { ConversationHistoryPage } from "@/definition/Conversation";
import type { ConversationReplyMode } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { AgentToolCallView } from "./AgentToolCallView";
import type { QueuedAgentMessage } from "./AgentEmployeeSessions";
import type { AgentChatSessionService } from "./AgentChatSessionService";
import type { AgentMessageQueue } from "@/definition/AgentSessionLimits";
import type { ChatConversations } from "./ChatConversationView";
import type {
  VirtualChatDirectory,
  VirtualChatHistoryPage,
  VirtualChatMessage,
  VirtualContactChoice,
  VirtualGroup,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";

/** What a job without tool calls shows. */
const NO_TOOL_CALLS: AgentToolCallView = { byMessage: {}, current: [] };

/** The person's history with an agent and what its newest job does now. */
interface AgentHistory {
  readonly messages: readonly VirtualChatMessage[];
  readonly isWorking: boolean;
  /** The tool calls of the answer in progress (PAGE-303). */
  readonly liveTools: readonly VirtualToolUse[];
  readonly accessLevel: AgentEmployeeAccess | undefined;
  /** The session of the agent in this chat (PAGE-376); absent before the first message. */
  readonly session?: AgentChatSessionBrief | undefined;
}

/** Messages of one history the page shows at most. */
const HISTORY_MESSAGES = 200;
/** Entries a participant list may hold. */
const MAXIMUM_CONTACTS = 500;

/** What the directory of the chat page reads. */
export interface ChatDirectoryDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findAll">;
  /** The active accounts, the same source as the owner choice of the wiki. */
  readonly lookups: Pick<WikiLookupRepository, "listActiveUsers">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  /** The stored conversations with people and of groups (PAGE-278). */
  readonly conversations: Pick<ConversationReader, "views" | "history">;
  /** Whether a job of the agent's conversation with the person runs now. */
  readonly isWorking: (agent: User, sessionId: string) => Promise<boolean>;
  /** The tool calls of the newest job of an agent's conversation (PAGE-303). */
  readonly toolCalls?: (
    agent: User,
    sessionId: string,
  ) => Promise<AgentToolCallView>;
  /** The agents answering in a stored conversation now (PAGE-276). */
  readonly workingAgentIds?: (conversationId: string) => readonly string[];
  /** The messages of a stored conversation whose answer waits (PAGE-304). */
  readonly queuedMessages?: (
    conversationId: string,
  ) => ReadonlyMap<string, AgentMessageQueue>;
  /** The messages of a direct chat with an agent its running job holds back (PAGE-304). */
  readonly waitingInJob?: (
    agent: User,
    sessionId: string,
  ) => Promise<ReadonlySet<string>>;
  /** The sessions of agents in the chats, for the head of the chat (PAGE-376). */
  readonly agentSessions?: Pick<
    AgentChatSessionService,
    "directBrief" | "groupBriefs"
  >;
  /** How many messages of a conversation wait for one agent (PAGE-376). */
  readonly queuedFor?: (conversationId: string, agentId: string) => number;
  /** The person's messages to an agent that wait for a free place (PAGE-304). */
  readonly queuedAgentMessages?: (
    agentId: string,
    personId: string,
  ) => readonly QueuedAgentMessage[];
  /** The reply mode of groups, which the group menu names (PAGE-379); absent shows none. */
  readonly replyModes?: (
    conversationIds: readonly string[],
  ) => Promise<ReadonlyMap<string, ConversationReplyMode>>;
  /** The conversations of agents only that administrators and leaders read (PAGE-311). */
  readonly oversight?: Pick<ConversationOversight, "views" | "history">;
  /** Tells whether a chain of agent messages paused a conversation (PAGE-311). */
  readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  /** The current time; tests pass a fixed one. */
  readonly now?: () => Date;
}

/** The facts of one account the page shows. */
interface AccountFacts {
  readonly user: User;
  /** The job title of an agent; empty for a person. */
  readonly jobTitle: string;
  /** Whether the account is among the active accounts a list can take. */
  readonly isChoosable: boolean;
}

function avatarImage(user: User): string | null {
  return user.avatarType === "image" ? (user.avatarImageUrl ?? null) : null;
}

/** Marks the agents that nothing is shared from (PAGE-305). */
function withConfidentiality(
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

function contactChoice(facts: AccountFacts): VirtualContactChoice {
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
function latest(first: string, second: string | undefined): string {
  return second !== undefined && second > first ? second : first;
}

function group(
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

/** The groups of the page: the person's own and the shared ones they belong to. */
function groupsOf(
  records: readonly ChatGroupRecord[],
  shownIds: ReadonlySet<string>,
  conversations: ChatConversations,
  person: User,
): VirtualGroup[] {
  const ownIds = new Set(records.map((record) => record.id));
  return [
    ...records.map((record) =>
      group(record, shownIds, conversations.groups.get(record.id)),
    ),
    ...[...conversations.groups.values()]
      .filter((view) => !ownIds.has(view.summary.id))
      .map((view) => sharedGroup(view, person)),
  ];
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

/** The entries of the page whose stored history holds older messages (PAGE-275). */
function olderHistoryIds(conversations: ChatConversations): string[] {
  return [...conversations.direct, ...conversations.groups]
    .filter(([, view]) => view.hasMore)
    .map(([id]) => id);
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

/** Two histories as one, oldest first; the messages of the first stay before equal times. */
function mergeByTime(
  first: readonly VirtualChatMessage[],
  second: readonly VirtualChatMessage[],
): VirtualChatMessage[] {
  return [...first, ...second].sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? ""),
  );
}

/**
 * The chat page of one person (PAGE-266, PAGE-259): their own participants
 * and groups, the people and agents the list can take, and their history
 * with every agent.
 *
 * @remarks
 * The list holds only existing accounts. Removing an entry removes it from
 * the person's own list and groups; the account or agent stays. The own
 * account is never offered, and neither an inactive person nor a deactivated
 * agent can be added. Both lists come newest activity first.
 */
export class ChatDirectoryService {
  private readonly dependencies: ChatDirectoryDependencies;

  public constructor(dependencies: ChatDirectoryDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the chat page of the person.
   *
   * @remarks
   * A person who wrote to them directly joins the list for this reading,
   * so a conversation started elsewhere, such as in Pica Mobile, is never
   * hidden; histories of people and groups come from the stored
   * conversations (PAGE-278).
   */
  public async directory(person: User): Promise<VirtualChatDirectory> {
    const accounts = await this.accounts(person);
    const [contacts, groups, views] = await Promise.all([
      this.dependencies.store.contacts().list(person.id),
      this.dependencies.store.groups().list(person.id),
      this.dependencies.conversations.views(person),
    ]);
    const conversations = splitConversations(views, person);
    const agentChats = agentWrittenConversations(views, person);
    const participants: VirtualParticipant[] = [];
    const histories: Record<string, readonly VirtualChatMessage[]> = {};
    const liveToolUses: Record<string, readonly VirtualToolUse[]> = {};
    for (const contact of this.withConversationPartners(contacts, [
      ...conversations.direct,
      ...agentChats,
    ])) {
      const facts = accounts.get(contact.contactId);
      if (!facts) continue;
      const view = conversations.direct.get(contact.contactId);
      const agentChat = agentChats.get(contact.contactId);
      const history: AgentHistory | null = view
        ? {
            messages: this.conversationHistory(view, person),
            isWorking: false,
            liveTools: [],
            accessLevel: undefined,
          }
        : await this.history(person, facts.user, agentChat);
      participants.push(
        this.participant(facts, contact, {
          isWorking: history !== null && history.isWorking,
          view,
          accessLevel: history?.accessLevel,
          agentChat,
          session: history?.session,
        }),
      );
      if (history) histories[contact.contactId] = history.messages;
      if (history?.isWorking === true && history.liveTools.length > 0)
        liveToolUses[contact.contactId] = history.liveTools;
    }
    for (const [groupId, view] of conversations.groups)
      histories[groupId] = markQueuedMessages(
        this.conversationHistory(view, person),
        this.dependencies.queuedMessages?.(groupId) ?? new Map(),
      );
    const overseen = await this.overseenConversations(person, accounts);
    Object.assign(histories, overseen.histories);
    const paused = await this.pausedGroupIds(conversations);
    const replyModes = await this.dependencies.replyModes?.([
      ...conversations.groups.keys(),
    ]);
    const shownIds = new Set(participants.map((participant) => participant.id));
    const chats = this.dependencies.store.chats();
    // Which chats nothing is shared from (PAGE-305).
    const [confidentialAgents, confidentialGroups] = await Promise.all([
      chats.confidentialAgents(person.id),
      chats.confidentialConversations(person.id),
    ]);
    return {
      participants: withConfidentiality(participants, confidentialAgents),
      groups: [
        ...(await Promise.all(
          groupsOf(groups, shownIds, conversations, person).map(
            async (entry) => {
              const working = this.workingAgents(entry.id, accounts);
              const agentSessions = await this.groupSessions(
                entry.id,
                working.map((agent) => agent.id),
              );
              return {
                ...entry,
                workingAgentNames: working.map((agent) => agent.name),
                workingAgents: working,
                isConfidential: confidentialGroups.has(entry.id),
                ...(replyModes === undefined
                  ? {}
                  : {
                      replyMode:
                        replyModes.get(entry.id) ??
                        CONVERSATION_DEFAULT_REPLY_MODE,
                    }),
                ...(paused.has(entry.id) ? { isAgentPaused: true } : {}),
                ...(agentSessions.length > 0 ? { agentSessions } : {}),
              };
            },
          ),
        )),
        ...overseen.groups.filter(({ id }) => !conversations.groups.has(id)),
      ],
      histories,
      liveToolUses,
      olderHistoryIds: [
        ...olderHistoryIds(conversations),
        ...overseen.olderHistoryIds,
      ],
      contactChoices: [...accounts.values()]
        .filter((facts) => facts.isChoosable || facts.user.isAgent === true)
        .map(contactChoice),
    };
  }

  /**
   * Reads the messages of a stored conversation before one the page shows,
   * newest page first (PAGE-275).
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for a malformed ID or a message outside it.
   */
  public async olderMessages(
    person: User,
    target: { readonly conversationId: unknown; readonly beforeId: unknown },
  ): Promise<VirtualChatHistoryPage> {
    if (
      typeof target.conversationId !== "string" ||
      typeof target.beforeId !== "string"
    )
      throw new ConversationError("invalid");
    const page = await this.readHistory(
      person,
      target.conversationId,
      target.beforeId,
      { withDecisions: true },
    );
    return {
      conversationId: page.conversationId,
      messages: page.messages.map((message) =>
        toVirtualMessage(message, person),
      ),
      hasMore: page.hasMore,
    };
  }

  /**
   * Replaces the person's participant list.
   *
   * @remarks
   * New entries are added newest last in the given order, so the last one
   * checked heads the list; kept entries keep their last activity.
   *
   * @throws {AgentEmployeeError} `invalidInput` for an unknown or the own
   * account, or for an inactive person or deactivated agent that was not in
   * the list before.
   */
  public async saveContacts(person: User, input: unknown): Promise<void> {
    if (
      !Array.isArray(input) ||
      input.length > MAXIMUM_CONTACTS ||
      !input.every((entry): entry is string => typeof entry === "string")
    )
      throw new AgentEmployeeError("invalidInput");
    const ids = [...new Set(input)];
    const accounts = await this.accounts(person);
    const current = new Set(
      (await this.dependencies.store.contacts().list(person.id)).map(
        (entry) => entry.contactId,
      ),
    );
    const added = ids.filter((id) => !current.has(id));
    for (const id of added)
      if (accounts.get(id)?.isChoosable !== true)
        throw new AgentEmployeeError("invalidInput");
    const start = (this.dependencies.now?.() ?? new Date()).getTime();
    const additions = new Map(
      added.map((id, index) => [id, new Date(start + index).toISOString()]),
    );
    await this.dependencies.store.contacts().replace(
      person.id,
      additions,
      ids.filter((id) => current.has(id)),
    );
  }

  /** A page of a conversation of the person, or of one of agents only the person oversees (PAGE-311). */
  private async readHistory(
    person: User,
    conversationId: string,
    beforeId: string,
    options: ConversationHistoryOptions,
  ): Promise<ConversationHistoryPage> {
    try {
      return await this.dependencies.conversations.history(
        person,
        conversationId,
        beforeId,
        options,
      );
    } catch (error: unknown) {
      const { oversight } = this.dependencies;
      if (
        !oversight ||
        !(error instanceof ConversationError) ||
        error.code !== "not_found"
      )
        throw error;
      return oversight.history(person, conversationId, beforeId);
    }
  }

  /** The groups whose agents wrote the most they may in a row (PAGE-311). */
  private async pausedGroupIds(
    conversations: ChatConversations,
  ): Promise<Set<string>> {
    const { guard } = this.dependencies;
    const paused = new Set<string>();
    if (!guard) return paused;
    for (const [groupId, view] of conversations.groups)
      if (
        view.summary.lastMessage?.sender.kind === "agent" &&
        (await guard.isPaused(groupId))
      )
        paused.add(groupId);
    return paused;
  }

  /** The conversations of agents only the person reads as an administrator or leader, shown as read-only groups. */
  private async overseenConversations(
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
    const { oversight, guard } = this.dependencies;
    if (!oversight) return result;
    for (const view of await oversight.views(person)) {
      const { summary } = view;
      const members = summary.members.flatMap(({ id }) => {
        const facts = accounts.get(id);
        return facts
          ? [
              this.participant(
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
      result.histories[summary.id] = this.conversationHistory(view, person);
      if (view.hasMore) result.olderHistoryIds.push(summary.id);
    }
    return result;
  }

  /** The sessions of the agents in a group, with what each agent does in it now (PAGE-376). */
  private async groupSessions(
    groupId: string,
    workingIds: readonly string[],
  ): Promise<AgentChatSessionBrief[]> {
    const { agentSessions, queuedFor } = this.dependencies;
    if (!agentSessions) return [];
    return agentSessions.groupBriefs(groupId, (agentId) => ({
      isWorking: workingIds.includes(agentId),
      waitingMessages: queuedFor?.(groupId, agentId) ?? 0,
    }));
  }

  /** The agents answering in a group now, with their names. */
  private workingAgents(
    groupId: string,
    accounts: ReadonlyMap<string, AccountFacts>,
  ): { readonly id: string; readonly name: string }[] {
    return (this.dependencies.workingAgentIds?.(groupId) ?? []).flatMap(
      (id) => {
        const facts = accounts.get(id);
        return facts ? [{ id, name: facts.user.displayName }] : [];
      },
    );
  }

  /** Every account but the person's own, with what the page names it by. */
  private async accounts(person: User): Promise<Map<string, AccountFacts>> {
    const [users, active, titles] = await Promise.all([
      this.dependencies.users.findAll(),
      this.dependencies.lookups.listActiveUsers(),
      this.dependencies.store.identities().jobTitles(),
    ]);
    const activeIds = new Set(active.map((user) => user.id));
    return new Map(
      users
        .filter((user) => user.id !== person.id)
        .map((user) => [
          user.id,
          {
            user,
            jobTitle: titles.get(user.id) ?? "",
            isChoosable: user.isActive && activeIds.has(user.id),
          },
        ]),
    );
  }

  /** The person's list with everybody who has a direct conversation with them. */
  private withConversationPartners(
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

  private conversationHistory(
    view: ConversationView,
    person: User,
  ): VirtualChatMessage[] {
    return view.messages.map((message) => toVirtualMessage(message, person));
  }

  private participant(
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
      lastActivityAt: latest(
        contact.lastActivityAt,
        view?.summary.lastActivityAt,
      ),
      ...(state.accessLevel ? { accessLevel: state.accessLevel } : {}),
      ...(state.session ? { session: state.session } : {}),
    };
  }

  /** The person's history with an agent, or `null` for a person or no conversation. */
  private async history(
    person: User,
    agent: User,
    agentChat?: ConversationView,
  ): Promise<AgentHistory | null> {
    if (agent.isAgent !== true) return null;
    const [conversation, employee] = await Promise.all([
      this.dependencies.store.conversations().find(agent.id, person.id, "chat"),
      this.dependencies.store.employees().find(agent.id),
    ]);
    const accessLevel = employee?.access;
    const queued = queuedChatMessages(
      this.dependencies.queuedAgentMessages?.(agent.id, person.id) ?? [],
    );
    // What the agent wrote to the person on its own joins the chat by time (PAGE-311).
    const written = (agentChat?.messages ?? [])
      .filter((message) => isAgentWritten(message, agent.id))
      .map((message) => toVirtualMessage(message, person));
    if (!conversation)
      return {
        messages: [...written, ...queued],
        isWorking: queued.length > 0,
        liveTools: [],
        accessLevel,
      };
    const { sessionId } = conversation;
    const [stored, isWorking, calls, waiting] = await Promise.all([
      this.dependencies.messages.messages(sessionId),
      this.dependencies.isWorking(agent, sessionId),
      this.dependencies.toolCalls?.(agent, sessionId) ?? NO_TOOL_CALLS,
      this.dependencies.waitingInJob?.(agent, sessionId) ?? new Set<string>(),
    ]);
    const messages: VirtualChatMessage[] = stored
      .slice(-HISTORY_MESSAGES)
      .map((message) => ({
        id: message.id,
        authorId: message.role === "user" ? null : agent.id,
        content: message.content,
        toolUses: calls.byMessage[message.id] ?? [],
        ...(written.length > 0 ? { createdAt: message.createdAt } : {}),
      }));
    const isBusy = isWorking || queued.length > 0;
    const chat = markQueuedMessages(messages, waitingInChat(messages, waiting));
    return {
      messages: [
        ...(written.length === 0 ? chat : mergeByTime(chat, written)),
        ...queued,
      ],
      // A message waiting for a place keeps the page reading the history.
      isWorking: isBusy,
      liveTools: calls.current,
      accessLevel,
      session: await this.dependencies.agentSessions?.directBrief(
        agent.id,
        person.id,
        {
          isWorking: isBusy,
          waitingMessages: waiting.size + queued.length,
        },
      ),
    };
  }
}

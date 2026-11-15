import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";

import {
  agentWrittenConversations,
  isShownWithAgentChat,
  splitConversations,
  toVirtualMessage,
} from "./ChatConversationView";
import {
  contactChoice,
  conversationHistory,
  directoryParticipant,
  groupsOfDirectory,
  mergeByTime,
  olderHistoryIds,
  withConfidentiality,
  withConversationPartners,
  type AccountFacts,
  type AgentHistory,
} from "./ChatDirectoryView";
import {
  markQueuedMessages,
  markSteeredMessages,
  queuedChatMessages,
  waitingInChat,
} from "./ChatMessageQueues";

import type { ChatContactEntry } from "@/backend/database/repositories/employee/ChatContactRepository";
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
import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
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
  VirtualGroup,
  VirtualParticipant,
  VirtualToolUse,
} from "@/definition/VirtualChat";

/** What a job without tool calls shows. */
const NO_TOOL_CALLS: AgentToolCallView = { byMessage: {}, current: [] };

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
  /** The messages of a stored conversation running answers took, with their agents (PAGE-381). */
  readonly steeredMessages?: (
    conversationId: string,
  ) => ReadonlyMap<string, readonly string[]>;
  /** The messages of a direct chat with an agent its running job took into its answer (PAGE-381). */
  readonly injectedInJob?: (
    agent: User,
    sessionId: string,
  ) => Promise<ReadonlySet<string>>;
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
  /** The models of agents in chats and the rights of the person in a group (PAGE-380); absent shows none. */
  readonly chatControl?: {
    modelLabels(chat: {
      readonly kind: "direct" | "group";
      readonly chatId: string;
      readonly agentIds: readonly string[];
    }): Promise<Record<string, AgentChatModelLabel>>;
    groupRights(
      person: User,
      groupId: string,
    ): Promise<{ readonly isOwner: boolean; readonly canControl: boolean }>;
  };
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
    const { participants, histories, liveToolUses } =
      await this.collectParticipants(person, accounts, {
        contacts,
        conversations,
        agentChats,
      });
    const overseen = await this.overseenConversations(person, accounts);
    Object.assign(histories, overseen.histories);
    const shownIds = new Set(participants.map((participant) => participant.id));
    const chats = this.dependencies.store.chats();
    // Which chats nothing is shared from (PAGE-305).
    const [confidentialAgents, groupEntries, participantList] =
      await Promise.all([
        chats.confidentialAgents(person.id),
        this.buildGroupEntries(person, accounts, {
          groups,
          shownIds,
          conversations,
        }),
        this.withChatModels(person, participants),
      ]);
    return {
      participants: withConfidentiality(participantList, confidentialAgents),
      groups: [
        ...groupEntries,
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

  /** Collects direct participants, their histories, live tools, and group histories. */
  private async collectParticipants(
    person: User,
    accounts: ReadonlyMap<string, AccountFacts>,
    input: {
      readonly contacts: readonly ChatContactEntry[];
      readonly conversations: ChatConversations;
      readonly agentChats: ReadonlyMap<string, ConversationView>;
    },
  ): Promise<{
    readonly participants: VirtualParticipant[];
    readonly histories: Record<string, readonly VirtualChatMessage[]>;
    readonly liveToolUses: Record<string, readonly VirtualToolUse[]>;
  }> {
    const participants: VirtualParticipant[] = [];
    const histories: Record<string, readonly VirtualChatMessage[]> = {
      ...this.collectGroupHistories(person, input.conversations.groups),
    };
    const liveToolUses: Record<string, readonly VirtualToolUse[]> = {};
    for (const contact of withConversationPartners(input.contacts, [
      ...input.conversations.direct,
      ...input.agentChats,
    ])) {
      const facts = accounts.get(contact.contactId);
      if (!facts) continue;
      const view = input.conversations.direct.get(contact.contactId);
      const agentChat = input.agentChats.get(contact.contactId);
      const history = view
        ? {
            messages: conversationHistory(view, person),
            isWorking: false,
            liveTools: [],
            accessLevel: undefined,
          }
        : await this.history(person, facts.user, agentChat);
      participants.push(
        directoryParticipant(facts, contact, {
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
    return { participants, histories, liveToolUses };
  }

  private collectGroupHistories(
    person: User,
    groups: ReadonlyMap<string, ConversationView>,
  ): Record<string, readonly VirtualChatMessage[]> {
    const histories: Record<string, readonly VirtualChatMessage[]> = {};
    for (const [groupId, view] of groups)
      histories[groupId] = markSteeredMessages(
        markQueuedMessages(
          conversationHistory(view, person),
          this.dependencies.queuedMessages?.(groupId) ?? new Map(),
        ),
        this.dependencies.steeredMessages?.(groupId) ?? new Map(),
      );
    return histories;
  }

  /** Builds the visible group entries enriched with live status, confidentiality, and control metadata. */
  private async buildGroupEntries(
    person: User,
    accounts: ReadonlyMap<string, AccountFacts>,
    input: {
      readonly groups: Parameters<typeof groupsOfDirectory>[0];
      readonly shownIds: ReadonlySet<string>;
      readonly conversations: ChatConversations;
    },
  ): Promise<VirtualGroup[]> {
    const [paused, replyModes, confidentialGroups] = await Promise.all([
      this.pausedGroupIds(input.conversations),
      this.dependencies.replyModes?.([...input.conversations.groups.keys()]),
      this.dependencies.store.chats().confidentialConversations(person.id),
    ]);
    return Promise.all(
      groupsOfDirectory(
        input.groups,
        input.shownIds,
        input.conversations,
        person,
      ).map(async (entry) => {
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
                  replyModes.get(entry.id) ?? CONVERSATION_DEFAULT_REPLY_MODE,
              }),
          ...(paused.has(entry.id) ? { isAgentPaused: true } : {}),
          ...(agentSessions.length > 0 ? { agentSessions } : {}),
          ...(await this.groupControl(person, entry, accounts)),
        };
      }),
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
              directoryParticipant(
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
      result.histories[summary.id] = conversationHistory(view, person);
      if (view.hasMore) result.olderHistoryIds.push(summary.id);
    }
    return result;
  }

  /** The model each agent of the person's list answers with in its direct chat (PAGE-380). */
  private async withChatModels(
    person: User,
    participants: readonly VirtualParticipant[],
  ): Promise<VirtualParticipant[]> {
    const { chatControl } = this.dependencies;
    if (!chatControl) return [...participants];
    const labels = await chatControl.modelLabels({
      kind: "direct",
      chatId: person.id,
      agentIds: participants
        .filter((participant) => participant.kind === "agent")
        .map((participant) => participant.id),
    });
    return participants.map((participant) => {
      const label = labels[participant.id];
      return label ? { ...participant, chatModel: label } : participant;
    });
  }

  /** The models of the agents of a group and the rights of the person in it (PAGE-380). */
  private async groupControl(
    person: User,
    targetGroup: Pick<VirtualGroup, "id" | "memberIds">,
    accounts: ReadonlyMap<string, AccountFacts>,
  ): Promise<Partial<VirtualGroup>> {
    const { chatControl } = this.dependencies;
    if (!chatControl) return {};
    const agentIds = targetGroup.memberIds.filter(
      (id) => accounts.get(id)?.user.isAgent === true,
    );
    const [agentModels, rights] = await Promise.all([
      chatControl.modelLabels({
        kind: "group",
        chatId: targetGroup.id,
        agentIds,
      }),
      chatControl.groupRights(person, targetGroup.id),
    ]);
    return {
      agentModels,
      isOwner: rights.isOwner,
      canControlSessions: rights.canControl,
    };
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
      .filter((message) => isShownWithAgentChat(message, agent.id))
      .map((message) => toVirtualMessage(message, person));
    if (!conversation)
      return {
        messages: [...written, ...queued],
        isWorking: queued.length > 0,
        liveTools: [],
        accessLevel,
      };
    return this.existingAgentHistory({
      person,
      agent,
      sessionId: conversation.sessionId,
      written,
      queued,
      accessLevel,
    });
  }

  /** Reads stored messages and live state for an existing agent direct session. */
  private async existingAgentHistory(input: {
    readonly person: User;
    readonly agent: User;
    readonly sessionId: string;
    readonly written: readonly VirtualChatMessage[];
    readonly queued: readonly VirtualChatMessage[];
    readonly accessLevel: AgentEmployeeAccess | undefined;
  }): Promise<AgentHistory> {
    const { person, agent, sessionId, written, queued, accessLevel } = input;
    const [stored, isWorking, calls, waiting, injected] = await Promise.all([
      this.dependencies.messages.messages(sessionId),
      this.dependencies.isWorking(agent, sessionId),
      this.dependencies.toolCalls?.(agent, sessionId) ?? NO_TOOL_CALLS,
      this.dependencies.waitingInJob?.(agent, sessionId) ?? new Set<string>(),
      this.dependencies.injectedInJob?.(agent, sessionId) ?? new Set<string>(),
    ]);
    const messages: VirtualChatMessage[] = stored
      .slice(-HISTORY_MESSAGES)
      .map((message) => ({
        id: message.id,
        authorId: message.role === "user" ? null : agent.id,
        content: message.content,
        toolUses: calls.byMessage[message.id] ?? [],
        ...(written.length > 0 ? { createdAt: message.createdAt } : {}),
        ...(message.isFromPreview === true ? { isFromPreview: true } : {}),
      }));
    const isBusy = isWorking || queued.length > 0;
    const chat = markSteeredMessages(
      markQueuedMessages(messages, waitingInChat(messages, waiting)),
      new Map([...injected].map((id) => [id, [agent.id]] as const)),
    );
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

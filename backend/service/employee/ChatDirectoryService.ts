import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ConversationError } from "@/backend/error/ConversationError";
import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";

import { addAnswerDetails, type AnswerModelReader } from "./ChatAnswerModels";
import { ChatAgentHistories } from "./ChatAgentHistory";
import {
  agentWrittenConversations,
  splitConversations,
  toVirtualMessage,
} from "./ChatConversationView";
import {
  contactChoice,
  conversationHistory,
  directoryParticipant,
  groupsOfDirectory,
  olderHistoryIds,
  withConfidentiality,
  withConversationPartners,
  type AccountFacts,
} from "./ChatDirectoryView";
import { markQueuedMessages, markSteeredMessages } from "./ChatMessageQueues";
import { ChatNotificationDigestReader } from "./ChatNotificationDigest";
import { ChatToolDetails, deferToolDetails } from "./ChatToolDetails";

import type { ChatContactEntry } from "@/backend/database/repositories/employee/ChatContactRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ConversationSummary } from "@/definition/Conversation";
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
import type { ChatNotificationDigest } from "@/definition/ChatNotificationDigest";
import type { ConversationHistoryPage } from "@/definition/Conversation";
import type { ConversationReplyMode } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import type { AgentMessageQueue } from "@/definition/AgentSessionLimits";
import type { ConversationAnswerJob } from "@/definition/ConversationAnswerJob";
import type { ChatAgentHistoryDependencies } from "./ChatAgentHistory";
import type { ChatConversations } from "./ChatConversationView";
import type { ToolDetailsQuery } from "./ChatToolDetails";
import type {
  VirtualChatDirectory,
  VirtualChatHistoryPage,
  VirtualChatMessage,
  VirtualGroup,
  VirtualParticipant,
  VirtualToolDetails,
  VirtualToolUse,
} from "@/definition/VirtualChat";

/** Entries a participant list may hold. */
const MAXIMUM_CONTACTS = 500;

/**
 * Whether a conversation of the person carries its newest messages in a
 * reading: a shown group or direct chat with a person, and every direct
 * conversation with an agent, whose messages tell whether the agent wrote
 * to the person on its own.
 */
function carriesMessages(
  summary: ConversationSummary,
  person: User,
  isShown: (id: string) => boolean,
): boolean {
  if (summary.kind === "group") return isShown(summary.id);
  const other = summary.members.find((member) => member.id !== person.id);
  return other !== undefined && (other.kind === "agent" || isShown(other.id));
}

/** Which histories one reading of the directory holds. */
export interface ChatDirectoryScope {
  /**
   * The participants and groups whose history is read, such as the chat that
   * opens; absent reads every history. The other chats come with their list
   * entry only, so the page does not read histories it does not show.
   */
  readonly historyIds?: readonly string[];
}

/** What the directory of the chat page reads. */
export interface ChatDirectoryDependencies extends ChatAgentHistoryDependencies {
  readonly users: Pick<UserRepository, "findAll" | "findById">;
  /** The active accounts, the same source as the owner choice of the wiki. */
  readonly lookups: Pick<WikiLookupRepository, "listActiveUsers">;
  readonly messages: Pick<
    ChatSessionRepository,
    "newestMessages" | "findMessage"
  >;
  /** The stored conversations with people and of groups. */
  readonly conversations: Pick<
    ConversationReader,
    "views" | "history" | "agentAnswer"
  >;
  /** The job each agent answering in a stored conversation runs now, by agent. */
  readonly workingJobs?: (
    conversationId: string,
  ) => ReadonlyMap<string, ConversationAnswerJob>;
  /** The messages of a stored conversation whose answer waits. */
  readonly queuedMessages?: (
    conversationId: string,
  ) => ReadonlyMap<string, AgentMessageQueue>;
  /** The messages of a stored conversation running answers took, with their agents. */
  readonly steeredMessages?: (
    conversationId: string,
  ) => ReadonlyMap<string, readonly string[]>;
  /** The models of agents in chats and the rights of the person in a group; absent shows none. */
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
  /** How many messages of a conversation wait for one agent. */
  readonly queuedFor?: (conversationId: string, agentId: string) => number;
  /** The reply mode of groups, which the group menu names; absent shows none. */
  readonly replyModes?: (
    conversationIds: readonly string[],
  ) => Promise<ReadonlyMap<string, ConversationReplyMode>>;
  /** The conversations of agents only that administrators and leaders read. */
  readonly oversight?: Pick<
    ConversationOversight,
    "views" | "history" | "agentAnswer"
  >;
  /** Tells whether a chain of agent messages paused a conversation. */
  readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  /** The cards of the questions of agents; absent shows their messages as text. */
  readonly questions?: Pick<AgentChatQuestionService, "views">;
  /** The models stored answers were written with; absent shows them without. */
  readonly answerModels?: AnswerModelReader;
  /** The current time; tests pass a fixed one. */
  readonly now?: () => Date;
}

/**
 * The chat page of one person: their own participants
 * and groups, the people and agents the list can take, and their history
 * with every agent.
 * @remarks
 * The list holds only existing accounts. Removing an entry removes it from
 * the person's own list and groups; the account or agent stays. The own
 * account is never offered, and neither an inactive person nor a deactivated
 * agent can be added. Both lists come newest activity first.
 */
export class ChatDirectoryService {
  private readonly dependencies: ChatDirectoryDependencies;
  private readonly agentHistories: ChatAgentHistories;
  private readonly toolDetailsReader: ChatToolDetails;
  private readonly notificationReader: ChatNotificationDigestReader;

  public constructor(dependencies: ChatDirectoryDependencies) {
    this.dependencies = dependencies;
    this.agentHistories = new ChatAgentHistories(dependencies);
    this.toolDetailsReader = new ChatToolDetails(dependencies);
    this.notificationReader = new ChatNotificationDigestReader(dependencies);
  }

  /**
   * Reads the chat page of the person.
   * @remarks
   * A person who wrote to them directly joins the list for this reading,
   * so a conversation started elsewhere, such as in Pica Mobile, is never
   * hidden; histories of people and groups come from the stored
   * conversations. Only the histories the scope names are read, with the
   * input and result of finished tool calls left for reading on demand.
   */
  public async directory(
    person: User,
    scope: ChatDirectoryScope = {},
  ): Promise<VirtualChatDirectory> {
    const { historyIds } = scope;
    const shownIds = historyIds === undefined ? null : new Set(historyIds);
    const isShown = (id: string): boolean => shownIds?.has(id) ?? true;
    const accounts = await this.accounts(person);
    const [contacts, groups, views] = await Promise.all([
      this.dependencies.store.contacts().list(person.id),
      this.dependencies.store.groups().list(person.id),
      this.dependencies.conversations.views(person, {
        withMessages: (summary) => carriesMessages(summary, person, isShown),
      }),
    ]);
    const conversations = splitConversations(views, person);
    const agentChats = agentWrittenConversations(views, person);
    const { participants, histories, liveToolUses } =
      await this.collectParticipants(person, accounts, {
        contacts,
        conversations,
        agentChats,
        isShown,
      });
    const overseen = await this.overseenConversations(
      person,
      accounts,
      isShown,
    );
    Object.assign(histories, overseen.histories);
    const listedIds = new Set(
      participants.map((participant) => participant.id),
    );
    const chats = this.dependencies.store.chats();
    // Which chats nothing is shared from.
    const [confidentialAgents, groupEntries, participantList] =
      await Promise.all([
        chats.confidentialAgents(person.id),
        this.buildGroupEntries(person, accounts, {
          groups,
          shownIds: listedIds,
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
      histories: await addAnswerDetails(this.dependencies, person, histories),
      ...(historyIds === undefined
        ? {}
        : { loadedHistoryIds: [...new Set(historyIds)] }),
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
   * newest page first.
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
      { withDecisions: true, withAgentAnswers: true },
    );
    const messages = deferToolDetails(
      page.messages.map((message) => toVirtualMessage(message, person)),
      { conversationId: page.conversationId },
    );
    const shown = await addAnswerDetails(this.dependencies, person, {
      page: messages,
    });
    return {
      conversationId: page.conversationId,
      messages: shown.page ?? messages,
      hasMore: page.hasMore,
    };
  }

  /**
   * Reads the input and the result of one tool call of a stored answer, which
   * the history leaves out until the person opens the call.
   * @throws {ConversationError} `invalid` for a malformed query, `not_found`
   * for a chat the person may not read or a call that does not exist.
   */
  public toolDetails(
    person: User,
    query: ToolDetailsQuery,
  ): Promise<VirtualToolDetails> {
    return this.toolDetailsReader.read(person, query);
  }

  /**
   * Reads the chats of the person with their newest message only, which the
   * notifications of the web interface follow instead of the histories.
   */
  public notificationDigest(person: User): Promise<ChatNotificationDigest> {
    return this.notificationReader.read(person);
  }

  /**
   * Replaces the person's participant list.
   * @remarks
   * New entries are added newest last in the given order, so the last one
   * checked heads the list; kept entries keep their last activity.
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
      readonly isShown: (id: string) => boolean;
    },
  ): Promise<{
    readonly participants: VirtualParticipant[];
    readonly histories: Record<string, readonly VirtualChatMessage[]>;
    readonly liveToolUses: Record<string, readonly VirtualToolUse[]>;
  }> {
    const participants: VirtualParticipant[] = [];
    const histories: Record<string, readonly VirtualChatMessage[]> = {
      ...this.collectGroupHistories(
        person,
        input.conversations.groups,
        input.isShown,
      ),
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
      const withMessages = input.isShown(contact.contactId);
      const history = view
        ? {
            messages: withMessages ? conversationHistory(view, person) : [],
            isWorking: false,
            liveTools: [],
            accessLevel: undefined,
          }
        : await this.agentHistories.read(person, facts.user, {
            agentChat,
            withMessages,
          });
      participants.push(
        directoryParticipant(facts, contact, {
          isWorking: history !== null && history.isWorking,
          view,
          accessLevel: history?.accessLevel,
          agentChat,
          session: history?.session,
        }),
      );
      if (history && withMessages)
        histories[contact.contactId] = history.messages;
      if (history?.isWorking === true && history.liveTools.length > 0)
        liveToolUses[contact.contactId] = history.liveTools;
    }
    return { participants, histories, liveToolUses };
  }

  private collectGroupHistories(
    person: User,
    groups: ReadonlyMap<string, ConversationView>,
    isShown: (id: string) => boolean,
  ): Record<string, readonly VirtualChatMessage[]> {
    const histories: Record<string, readonly VirtualChatMessage[]> = {};
    for (const [groupId, view] of groups)
      if (isShown(groupId))
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
    const entries = groupsOfDirectory(input.groups, {
      ...input,
      person,
      accounts,
    });
    return Promise.all(
      entries.map(async (entry) => {
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

  /** A page of a conversation of the person, or of one of agents only the person oversees. */
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

  /** The groups whose agents wrote the most they may in a row. */
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

  /** Builds the group rows of the directory with active agents and reply modes. */
  private async overseenConversations(
    person: User,
    accounts: ReadonlyMap<string, AccountFacts>,
    isShown: (id: string) => boolean,
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
    const views = await oversight.views(person, {
      withMessages: (summary) => isShown(summary.id),
    });
    for (const view of views) {
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
      if (isShown(summary.id))
        result.histories[summary.id] = conversationHistory(view, person);
      if (view.hasMore) result.olderHistoryIds.push(summary.id);
    }
    return result;
  }

  /** The model each agent of the person's list answers with in its direct chat. */
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

  /** The models of the agents of a group and the rights of the person in it. */
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

  /** The sessions of the agents in a group, with what each agent does in it now. */
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

  /** The agents answering in a group now, with their names and the job each one runs. */
  private workingAgents(
    groupId: string,
    accounts: ReadonlyMap<string, AccountFacts>,
  ): {
    readonly id: string;
    readonly name: string;
    readonly job: ConversationAnswerJob;
  }[] {
    const jobs = this.dependencies.workingJobs?.(groupId);
    return [...(jobs ?? [])].flatMap(([id, job]) => {
      const facts = accounts.get(id);
      return facts ? [{ id, name: facts.user.displayName, job }] : [];
    });
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
}

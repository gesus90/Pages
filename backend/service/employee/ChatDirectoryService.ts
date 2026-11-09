import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import type { ChatContactEntry } from "@/backend/database/repositories/employee/ChatContactRepository";
import type { ChatGroupRecord } from "@/backend/database/repositories/employee/ChatGroupRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import type { User } from "@/definition/User";
import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualContactChoice,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

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
  /** Whether a job of the agent's conversation with the person runs now. */
  readonly isWorking: (agent: User, sessionId: string) => Promise<boolean>;
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

function group(
  record: ChatGroupRecord,
  shownIds: ReadonlySet<string>,
): VirtualGroup {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    memberIds: record.memberIds.filter((id) => shownIds.has(id)),
    unreadCount: 0,
    lastActivityAt: record.lastActivityAt,
  };
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

  /** Reads the chat page of the person. */
  public async directory(person: User): Promise<VirtualChatDirectory> {
    const accounts = await this.accounts(person);
    const [contacts, groups] = await Promise.all([
      this.dependencies.store.contacts().list(person.id),
      this.dependencies.store.groups().list(person.id),
    ]);
    const participants: VirtualParticipant[] = [];
    const histories: Record<string, readonly VirtualChatMessage[]> = {};
    for (const contact of contacts) {
      const facts = accounts.get(contact.contactId);
      if (!facts) continue;
      const history = await this.history(person, facts.user);
      participants.push(
        this.participant(facts, contact, history !== null && history.isWorking),
      );
      if (history) histories[contact.contactId] = history.messages;
    }
    const shownIds = new Set(participants.map((participant) => participant.id));
    return {
      participants,
      groups: groups.map((record) => group(record, shownIds)),
      histories,
      contactChoices: [...accounts.values()]
        .filter((facts) => facts.isChoosable || facts.user.isAgent === true)
        .map(contactChoice),
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

  private participant(
    facts: AccountFacts,
    contact: ChatContactEntry,
    isWorking: boolean,
  ): VirtualParticipant {
    const { user } = facts;
    const isAgent = user.isAgent === true;
    let status: VirtualParticipant["status"] = user.isActive ? "active" : "off";
    if (user.isActive && isWorking) status = "working";
    return {
      id: user.id,
      name: user.displayName,
      kind: isAgent ? "agent" : "human",
      role: isAgent ? facts.jobTitle : "",
      username: user.username,
      color: user.avatarColor ?? null,
      avatarImageUrl: avatarImage(user),
      status,
      unreadCount: 0,
      canChat: isAgent && user.isActive,
      lastActivityAt: contact.lastActivityAt,
    };
  }

  /** The person's history with an agent, or `null` for a person or no conversation. */
  private async history(
    person: User,
    agent: User,
  ): Promise<{
    readonly messages: readonly VirtualChatMessage[];
    readonly isWorking: boolean;
  } | null> {
    if (agent.isAgent !== true) return null;
    const conversation = await this.dependencies.store
      .conversations()
      .find(agent.id, person.id, "chat");
    if (!conversation) return { messages: [], isWorking: false };
    const stored = await this.dependencies.messages.messages(
      conversation.sessionId,
    );
    return {
      messages: stored.slice(-HISTORY_MESSAGES).map((message) => ({
        id: message.id,
        authorId: message.role === "user" ? null : agent.id,
        content: message.content,
        toolUses: [],
      })),
      isWorking: await this.dependencies.isWorking(
        agent,
        conversation.sessionId,
      ),
    };
  }
}

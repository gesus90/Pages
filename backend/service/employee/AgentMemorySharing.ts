import { logCaughtError } from "@/backend/logging/Logger";

import { isSameChat } from "./AgentMemoryDocument";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { TaskService } from "@/backend/service/TaskService";
import type { WikiService } from "@/backend/service/WikiService";
import type {
  AgentMemoryChat,
  AgentMemorySource,
} from "@/definition/AgentMemory";

/** The chat a session of an agent runs in, and the people who take part. */
export interface AgentMemoryAudience {
  readonly agentId: string;
  /** The chat; `null` for a session without one, such as a dream run. */
  readonly chat: AgentMemoryChat | null;
  /** The people of the chat; agents are left out. */
  readonly people: readonly string[];
}

/** Whether a person may see a ticket or a wiki page, with their own rights. */
export interface AgentKnowledgeVisibility {
  canSeeTicket(personId: string, key: string): Promise<boolean>;
  canSeeWikiPage(personId: string, pageId: string): Promise<boolean>;
}

/** Something of the memory that carries its source. */
interface SourcedItem {
  readonly source: AgentMemorySource | null;
}

/** What the rules read. */
export interface AgentMemorySharingDependencies {
  readonly store: EmployeeStore;
  /** Without it no ticket or wiki page counts as visible, so nothing is shared by it. */
  readonly visibility?: AgentKnowledgeVisibility;
}

/**
 * Checks tickets and wiki pages with the rights of the person (PAGE-305):
 * the same reads the person's own pages use.
 */
export class AgentKnowledgeAccess implements AgentKnowledgeVisibility {
  private readonly users: Pick<UserRepository, "findById">;
  private readonly tickets: Pick<TaskService, "getByKey">;
  private readonly wiki: Pick<WikiService, "canView">;

  public constructor(parts: {
    readonly users: Pick<UserRepository, "findById">;
    readonly tickets: Pick<TaskService, "getByKey">;
    readonly wiki: Pick<WikiService, "canView">;
  }) {
    this.users = parts.users;
    this.tickets = parts.tickets;
    this.wiki = parts.wiki;
  }

  /** Whether the person reads the ticket; every refusal counts as no. */
  public async canSeeTicket(personId: string, key: string): Promise<boolean> {
    const person = await this.users.findById(personId);
    if (!person?.isActive) return false;
    try {
      await this.tickets.getByKey(person, key);
      return true;
    } catch (error: unknown) {
      // A hidden or missing ticket is refused like any other; it is no fault.
      if (error instanceof Error) return false;
      throw error;
    }
  }

  /** Whether the person reads the wiki page; every refusal counts as no. */
  public async canSeeWikiPage(
    personId: string,
    pageId: string,
  ): Promise<boolean> {
    const person = await this.users.findById(personId);
    if (!person?.isActive) return false;
    try {
      return await this.wiki.canView(person, pageId);
    } catch (error: unknown) {
      logCaughtError("AgentKnowledgeAccess", error);
      return false;
    }
  }
}

function chatKey(chat: AgentMemoryChat): string {
  return chat.kind === "person"
    ? `person:${chat.personId}`
    : `conversation:${chat.conversationId}`;
}

/**
 * The rules by which an agent shares knowledge between chats (PAGE-305).
 *
 * @remarks
 * - Knowledge of a chat is usable in that chat and in every chat whose
 *   people all took part in it, so a direct chat with a person shares with
 *   every other chat of that person alone.
 * - A chat with further people gets knowledge of other chats only when it
 *   hangs on tickets or wiki pages that every person of the chat may see.
 * - Nothing leaves a chat marked confidential.
 * - Knowledge without a source (written by hand or before PAGE-305) cannot
 *   be checked and is used only in chats with a single person.
 */
export class AgentMemorySharing {
  private readonly dependencies: AgentMemorySharingDependencies;

  public constructor(dependencies: AgentMemorySharingDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Keeps the items the audience may receive.
   *
   * @param audience - The chat and its people.
   * @param items - Entries of `MEMORY.md` or of the archive.
   * @returns The items in their order, without those the rules hold back.
   */
  public async filter<Item extends SourcedItem>(
    audience: AgentMemoryAudience,
    items: readonly Item[],
  ): Promise<Item[]> {
    const check = new SharingCheck(this.dependencies, audience);
    const visible: Item[] = [];
    for (const item of items)
      if (await check.allows(item.source)) visible.push(item);
    return visible;
  }
}

/** One application of the rules, with what it read kept for its items. */
class SharingCheck {
  private readonly dependencies: AgentMemorySharingDependencies;
  private readonly audience: AgentMemoryAudience;
  private readonly confidential = new Map<string, boolean>();
  private readonly people = new Map<string, readonly string[]>();
  private readonly visibleRefs = new Map<string, boolean>();

  public constructor(
    dependencies: AgentMemorySharingDependencies,
    audience: AgentMemoryAudience,
  ) {
    this.dependencies = dependencies;
    this.audience = audience;
  }

  /** Whether knowledge of this source may reach the audience. */
  public async allows(source: AgentMemorySource | null): Promise<boolean> {
    const { audience } = this;
    const hasRefs =
      source !== null &&
      (source.tickets.length > 0 || source.wikiPages.length > 0);
    const chat = source?.chat ?? null;
    if (chat === null && !hasRefs) return audience.people.length <= 1;
    if (chat !== null) {
      if (isSameChat(chat, audience.chat)) return true;
      if (await this.isConfidential(chat)) return false;
      const sourcePeople = await this.peopleOf(chat);
      if (
        audience.people.length > 0 &&
        audience.people.every((person) => sourcePeople.includes(person))
      )
        return true;
    }
    return hasRefs && this.refsVisible(source);
  }

  private async isConfidential(chat: AgentMemoryChat): Promise<boolean> {
    const key = chatKey(chat);
    const known = this.confidential.get(key);
    if (known !== undefined) return known;
    const value = await this.dependencies.store
      .chats()
      .isConfidential(this.audience.agentId, chat);
    this.confidential.set(key, value);
    return value;
  }

  private async peopleOf(chat: AgentMemoryChat): Promise<readonly string[]> {
    if (chat.kind === "person") return [chat.personId];
    const known = this.people.get(chat.conversationId);
    if (known) return known;
    const people = await this.dependencies.store
      .chats()
      .conversationPeople(chat.conversationId);
    this.people.set(chat.conversationId, people);
    return people;
  }

  private async refsVisible(source: AgentMemorySource): Promise<boolean> {
    const { visibility } = this.dependencies;
    if (!visibility || this.audience.people.length === 0) return false;
    const refs = [
      ...source.tickets.map((key) => ({ kind: "ticket" as const, id: key })),
      ...source.wikiPages.map((id) => ({ kind: "wiki" as const, id })),
    ];
    for (const ref of refs)
      for (const person of this.audience.people) {
        const key = `${ref.kind}:${ref.id}:${person}`;
        let isVisible = this.visibleRefs.get(key);
        if (isVisible === undefined) {
          isVisible =
            ref.kind === "ticket"
              ? await visibility.canSeeTicket(person, ref.id)
              : await visibility.canSeeWikiPage(person, ref.id);
          this.visibleRefs.set(key, isVisible);
        }
        if (!isVisible) return false;
      }
    return true;
  }
}

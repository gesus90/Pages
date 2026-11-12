import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { readMemorySource } from "@/backend/database/repositories/employee/AgentMemoryRepository";
import { AGENT_MEMORY_LIMITS, countWords } from "@/definition/AgentEmployee";
import { countCharacters } from "@/definition/AgentMemory";

import {
  mergeDreamLessons,
  parseDreamDocument,
  renderDreamDocument,
} from "./AgentDreamDocument";
import { limitWords, stripCredentials } from "./AgentEmployeeText";
import {
  fitMemoryDocument,
  parseMemoryDocument,
  renderMemoryDocument,
} from "./AgentMemoryDocument";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type {
  AgentArchiveEntry,
  AgentMemoryDetails,
  AgentMemoryVersionReason,
} from "@/definition/AgentEmployee";
import type { AgentMemorySource } from "@/definition/AgentMemory";
import type {
  AgentMemoryDocument,
  AgentMemoryEntry,
} from "./AgentMemoryDocument";
import type {
  AgentMemoryAudience,
  AgentMemorySharing,
} from "./AgentMemorySharing";

/** Versions kept per agent; older ones are removed. */
const KEPT_VERSIONS = 50;
/** Archive entries one search returns at most. */
const SEARCH_RESULTS = 5;
/** Archive entries one search reads before the rules of sharing apply. */
const SEARCH_CANDIDATES = 40;
/** Characters of one found entry handed to a session. */
const SEARCH_ENTRY_CHARACTERS = 2_000;
/** Search terms read from a query at most. */
const SEARCH_TERMS = 6;
/** Words a message lends to the search for related entries at most. */
const RELATED_TERMS = 10;
/** Shortest word of a message that counts for related entries. */
const RELATED_WORD_LENGTH = 4;

/** Which of the two files a change concerns. */
export type AgentMemoryFile = "memory" | "dream";

/** One archive entry as a session finds it. */
export interface AgentArchiveMatch {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly createdAt: string;
  readonly source: AgentMemorySource | null;
}

/** A version identifier that sorts by creation even within one second. */
function createVersionId(): string {
  return `${Date.now().toString(36).padStart(10, "0")}-${randomUUID()}`;
}

function readArchiveSnapshot(text: string): AgentArchiveEntry[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const id: unknown = Reflect.get(entry, "id");
    const title: unknown = Reflect.get(entry, "title");
    const content: unknown = Reflect.get(entry, "content");
    const createdAt: unknown = Reflect.get(entry, "createdAt");
    const source: unknown = Reflect.get(entry, "source");
    return typeof id === "string" &&
      typeof title === "string" &&
      typeof content === "string" &&
      typeof createdAt === "string"
      ? [
          {
            id,
            title,
            content,
            createdAt,
            source: readMemorySource(
              source === undefined || source === null
                ? null
                : JSON.stringify(source),
            ),
          },
        ]
      : [];
  });
}

/** Reads the search terms of a query: lower case, at least two characters, a few at most. */
function searchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .split(/\s+/u)
        .filter((term) => term.length >= 2),
    ),
  ].slice(0, SEARCH_TERMS);
}

/** The longer words of a message, the longest first, for related entries. */
function relatedTerms(message: string): string[] {
  return [
    ...new Set(
      message
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}-]+/u)
        .filter((term) => term.length >= RELATED_WORD_LENGTH),
    ),
  ]
    .sort((left, right) => right.length - left.length)
    .slice(0, RELATED_TERMS);
}

function bounded(entry: AgentArchiveEntry): AgentArchiveMatch {
  return {
    ...entry,
    content: entry.content.slice(0, SEARCH_ENTRY_CHARACTERS),
  };
}

/**
 * The memory of an agent (PAGE-266, PAGE-305): `MEMORY.md` with the
 * current topics, `DREAM.md` with the lessons, both loaded in every
 * session, and the archive, searched on demand.
 *
 * @remarks
 * `MEMORY.md` and `DREAM.md` keep the character limits of their agent, the
 * archive its word limit; none stores a recognizable credential. Every
 * change records a version of all three, which can be restored. Callers
 * authorize the person first; a session searches only the archive of its
 * own agent, and only the entries the rules of sharing give its chat.
 */
export class AgentMemoryService {
  private readonly store: EmployeeStore;
  private readonly sharing: AgentMemorySharing | null;

  public constructor(
    store: EmployeeStore,
    sharing: AgentMemorySharing | null = null,
  ) {
    this.store = store;
    this.sharing = sharing;
  }

  /** The archive and the versions of an agent, for an authorized view. */
  public async details(agentId: string): Promise<AgentMemoryDetails> {
    const memory = this.store.memory();
    const [archive, versions] = await Promise.all([
      memory.archive(agentId),
      memory.versions(agentId, KEPT_VERSIONS),
    ]);
    return { archive, versions };
  }

  /**
   * Replaces `MEMORY.md` or `DREAM.md` on the request of an authorized person.
   *
   * @throws {AgentEmployeeError} `invalidInput` for a text beyond the limit of the agent.
   */
  public async edit(
    store: EmployeeStore,
    input: {
      readonly agentId: string;
      readonly file: AgentMemoryFile;
      readonly text: string;
      readonly actorId: string;
    },
  ): Promise<void> {
    const text = stripCredentials(input.text.trim());
    const current = await store.employees().find(input.agentId);
    if (!current) throw new AgentEmployeeError("notFound");
    const isMemory = input.file === "memory";
    const maximum = isMemory
      ? current.memoryCharacters
      : current.dreamCharacters;
    if (countCharacters(text) > maximum)
      throw new AgentEmployeeError("invalidInput");
    if ((isMemory ? current.memory : current.dream) === text) return;
    if (isMemory) await store.employees().saveMemory(input.agentId, text);
    else await store.employees().saveDream(input.agentId, text);
    await this.recordVersion(store, input.agentId, "edit", input.actorId);
  }

  /**
   * Empties `MEMORY.md` or `DREAM.md`; the version before stays restorable.
   *
   * @throws {AgentEmployeeError} `notFound` for an unknown agent.
   */
  public async reset(
    agentId: string,
    file: AgentMemoryFile,
    actorId: string,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      if (!(await store.employees().touch(agentId, null)))
        throw new AgentEmployeeError("notFound");
      if (file === "memory") await store.employees().saveMemory(agentId, "");
      else await store.employees().saveDream(agentId, "");
      await this.recordVersion(store, agentId, "reset", actorId);
    });
  }

  /** Records the first version of a new agent. */
  public async initialize(
    store: EmployeeStore,
    agentId: string,
    actorId: string,
  ): Promise<void> {
    await this.recordVersion(store, agentId, "initial", actorId);
  }

  /**
   * Restores a version of `MEMORY.md`, `DREAM.md` and the archive and
   * raises the revision of the agent, since its memory changed.
   *
   * @remarks
   * The version names the revision of the agent the caller read; `null`
   * restores without that check.
   *
   * @throws {AgentEmployeeError} `notFound` for a version of another agent or
   * none, `conflict` for a stale revision.
   */
  public async restore(
    agentId: string,
    version: { readonly id: string; readonly expectedRevision: number | null },
    actorId: string,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      const found = await store.memory().findVersion(agentId, version.id);
      if (!found) throw new AgentEmployeeError("notFound");
      if (!(await store.employees().touch(agentId, version.expectedRevision)))
        throw new AgentEmployeeError("conflict");
      await this.apply(store, agentId, found);
      await this.recordVersion(store, agentId, "restore", actorId);
    });
  }

  /**
   * Changes `MEMORY.md` within the limit of the agent: the change reads the
   * current topics and returns the new ones; whatever does not fit moves
   * into the archive with its source, the oldest topics first.
   *
   * @param agentId - The agent.
   * @param change - Builds the new document and names finished topics for the archive.
   * @returns How many topics moved into the archive; `null` when the agent is gone.
   */
  public async updateMemory(
    agentId: string,
    change: (current: AgentMemoryDocument) => {
      readonly document: AgentMemoryDocument;
      readonly finished: readonly AgentMemoryEntry[];
    },
  ): Promise<number | null> {
    return this.store.transaction(async (store) => {
      const employee = await store.employees().find(agentId);
      if (!employee) return null;
      const changed = change(parseMemoryDocument(employee.memory));
      const fitted = fitMemoryDocument(
        changed.document,
        employee.memoryCharacters,
      );
      const memory = stripCredentials(renderMemoryDocument(fitted.document));
      const archived = [...changed.finished, ...fitted.moved];
      if (memory === employee.memory && archived.length === 0) return 0;
      await store.employees().saveMemory(agentId, memory);
      await this.archiveEntries(store, agentId, archived);
      await this.recordVersion(store, agentId, "update", null);
      return archived.length;
    });
  }

  /**
   * Brings both files within the limits of their agent after a limit was
   * lowered: `MEMORY.md` moves its oldest topics into the archive,
   * `DREAM.md` drops its weakest, then oldest lessons.
   */
  public async fitToLimits(agentId: string): Promise<void> {
    await this.updateMemory(agentId, (current) => ({
      document: current,
      finished: [],
    }));
    const employee = await this.store.employees().find(agentId);
    if (
      !employee ||
      countCharacters(employee.dream) <= employee.dreamCharacters
    )
      return;
    const today = new Date().toISOString().slice(0, 10);
    const fitted = mergeDreamLessons(
      parseDreamDocument(employee.dream, today),
      [],
      employee.dreamCharacters,
    );
    await this.saveDream(agentId, renderDreamDocument(fitted.lessons));
  }

  /** Replaces `DREAM.md` with what a dream run produced, already within its limit. */
  public async saveDream(agentId: string, dream: string): Promise<void> {
    await this.store.transaction(async (store) => {
      await store.employees().saveDream(agentId, stripCredentials(dream));
      await this.recordVersion(store, agentId, "dream", null);
    });
  }

  /**
   * Searches the archive of an agent; the archive is never handed over as a whole.
   *
   * @param agentId - The agent whose session searches.
   * @param query - Words to look for.
   * @param audience - The chat of the session; its rules of sharing filter the matches.
   * @returns The best matches, each cut to a bounded length.
   */
  public async search(
    agentId: string,
    query: string,
    audience: AgentMemoryAudience,
  ): Promise<readonly AgentArchiveMatch[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const found = await this.store
      .memory()
      .searchAny(agentId, terms, SEARCH_CANDIDATES);
    return (await this.share(audience, found))
      .slice(0, SEARCH_RESULTS)
      .map(bounded);
  }

  /**
   * The archive entries related to a new message, from every chat whose
   * knowledge the rules give the chat of the message (PAGE-305).
   */
  public async related(
    agentId: string,
    message: string,
    audience: AgentMemoryAudience,
  ): Promise<readonly AgentArchiveMatch[]> {
    const found = await this.store
      .memory()
      .searchAny(agentId, relatedTerms(message), SEARCH_CANDIDATES);
    return (await this.share(audience, found))
      .slice(0, SEARCH_RESULTS)
      .map(bounded);
  }

  /** Keeps the items the chat may receive; without rules only sourceless ones in a chat of one person. */
  public share<Item extends { readonly source: AgentMemorySource | null }>(
    audience: AgentMemoryAudience,
    items: readonly Item[],
  ): Promise<Item[]> {
    if (this.sharing) return this.sharing.filter(audience, items);
    return Promise.resolve(
      items.filter(
        (item) => item.source === null && audience.people.length <= 1,
      ),
    );
  }

  /** Moves topics of `MEMORY.md` into the archive with their source. */
  private async archiveEntries(
    store: EmployeeStore,
    agentId: string,
    entries: readonly AgentMemoryEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await store.memory().add(
      agentId,
      entries.map((entry) => {
        const title = stripCredentials(entry.title).slice(0, 200);
        const content = limitWords(
          stripCredentials(entry.text),
          AGENT_MEMORY_LIMITS.entryWords,
        );
        return {
          id: randomUUID(),
          title,
          content,
          wordCount: countWords(`${title} ${content}`),
          source: entry.source,
        };
      }),
    );
    await store.memory().trim(agentId, AGENT_MEMORY_LIMITS.archiveWords);
  }

  /** Writes the files and the archive of a stored version. */
  private async apply(
    store: EmployeeStore,
    agentId: string,
    version: {
      readonly memory: string;
      readonly dream: string;
      readonly archive: string;
    },
  ): Promise<void> {
    const entries = readArchiveSnapshot(version.archive);
    await store.employees().saveMemory(agentId, version.memory);
    await store.employees().saveDream(agentId, version.dream);
    await store.memory().clear(agentId);
    await store.memory().add(
      agentId,
      entries.map((entry) => ({
        id: randomUUID(),
        title: entry.title,
        content: entry.content,
        wordCount: countWords(`${entry.title} ${entry.content}`),
        createdAt: entry.createdAt,
        source: entry.source,
      })),
    );
  }

  private async recordVersion(
    store: EmployeeStore,
    agentId: string,
    reason: AgentMemoryVersionReason,
    actorId: string | null,
  ): Promise<void> {
    const employee = await store.employees().find(agentId);
    if (!employee) throw new AgentEmployeeError("notFound");
    const archive = await store.memory().archive(agentId);
    await store.memory().addVersion({
      id: createVersionId(),
      userId: agentId,
      reason,
      memory: employee.memory,
      dream: employee.dream,
      archive: JSON.stringify(archive),
      coreWords: countWords(employee.memory),
      archiveWords: archive.reduce(
        (sum, entry) => sum + countWords(`${entry.title} ${entry.content}`),
        0,
      ),
      createdBy: actorId,
    });
    await store.memory().pruneVersions(agentId, KEPT_VERSIONS);
  }
}

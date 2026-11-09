import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AGENT_MEMORY_LIMITS, countWords } from "@/definition/AgentEmployee";

import { limitWords, stripCredentials } from "./AgentEmployeeText";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type {
  AgentArchiveEntry,
  AgentMemoryDetails,
  AgentMemoryVersionReason,
} from "@/definition/AgentEmployee";

/** Versions kept per agent; older ones are removed. */
const KEPT_VERSIONS = 50;
/** Archive entries one search returns at most. */
const SEARCH_RESULTS = 5;
/** Characters of one found entry handed to a session. */
const SEARCH_ENTRY_CHARACTERS = 2_000;
/** Search terms read from a query at most. */
const SEARCH_TERMS = 6;

/** What a learning run changes in the memory of an agent. */
export interface AgentMemoryUpdate {
  readonly memory: string;
  readonly archiveAdd: readonly {
    readonly title: string;
    readonly content: string;
  }[];
  readonly archiveRemove: readonly string[];
}

/** One archive entry as a session finds it. */
export interface AgentArchiveMatch {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly createdAt: string;
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
    return typeof id === "string" &&
      typeof title === "string" &&
      typeof content === "string" &&
      typeof createdAt === "string"
      ? [{ id, title, content, createdAt }]
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

/**
 * The two levels of an agent's memory (PAGE-266): `MEMORY.md`, loaded in
 * every session, and the archive, searched only on demand.
 *
 * @remarks
 * Both levels keep their word limits and never store a recognizable
 * credential. Every change records a version of both, which can be
 * restored. Callers authorize the person first; a session searches only the
 * archive of its own agent.
 */
export class AgentMemoryService {
  private readonly store: EmployeeStore;

  public constructor(store: EmployeeStore) {
    this.store = store;
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
   * Replaces `MEMORY.md` on the request of an authorized person.
   *
   * @throws {AgentEmployeeError} `invalidInput` for a text beyond the word limit.
   */
  public async edit(
    store: EmployeeStore,
    input: {
      readonly agentId: string;
      readonly memory: string;
      readonly actorId: string;
    },
  ): Promise<void> {
    const memory = stripCredentials(input.memory.trim());
    if (countWords(memory) > AGENT_MEMORY_LIMITS.coreWords)
      throw new AgentEmployeeError("invalidInput");
    const current = await store.employees().find(input.agentId);
    if (!current) throw new AgentEmployeeError("notFound");
    if (current.memory === memory) return;
    await store.employees().saveMemory(input.agentId, memory);
    await this.recordVersion(store, input.agentId, "edit", input.actorId);
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
   * Restores a version of `MEMORY.md` and its archive and raises the
   * revision of the agent, since its memory changed.
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
   * Applies what a learning run produced, within both limits.
   *
   * @returns How many archive entries the word limit pushed out.
   */
  public async applyLearning(
    agentId: string,
    update: AgentMemoryUpdate,
  ): Promise<number> {
    return this.store.transaction(async (store) => {
      const memory = limitWords(
        stripCredentials(update.memory.trim()),
        AGENT_MEMORY_LIMITS.coreWords,
      );
      await store.employees().saveMemory(agentId, memory);
      await store.memory().remove(agentId, update.archiveRemove);
      await store.memory().add(
        agentId,
        update.archiveAdd.map((entry) => {
          const title = stripCredentials(entry.title.trim()).slice(0, 200);
          const content = limitWords(
            stripCredentials(entry.content.trim()),
            AGENT_MEMORY_LIMITS.entryWords,
          );
          return {
            id: randomUUID(),
            title,
            content,
            wordCount: countWords(`${title} ${content}`),
          };
        }),
      );
      const trimmed = await store
        .memory()
        .trim(agentId, AGENT_MEMORY_LIMITS.archiveWords);
      await this.recordVersion(store, agentId, "learning", null);
      return trimmed;
    });
  }

  /**
   * Searches the archive of an agent; the archive is never handed over as a whole.
   *
   * @param agentId - The agent whose session searches.
   * @param query - Words to look for.
   * @returns The best matches, each cut to a bounded length.
   */
  public async search(
    agentId: string,
    query: string,
  ): Promise<readonly AgentArchiveMatch[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const found = await this.store
      .memory()
      .search(agentId, terms, SEARCH_RESULTS);
    return found.map((entry) => ({
      ...entry,
      content: entry.content.slice(0, SEARCH_ENTRY_CHARACTERS),
    }));
  }

  /** Writes the memory and the archive of a stored version. */
  private async apply(
    store: EmployeeStore,
    agentId: string,
    version: { readonly memory: string; readonly archive: string },
  ): Promise<void> {
    const entries = readArchiveSnapshot(version.archive);
    await store.employees().saveMemory(agentId, version.memory);
    await store.memory().clear(agentId);
    await store.memory().add(
      agentId,
      entries.map((entry) => ({
        id: randomUUID(),
        title: entry.title,
        content: entry.content,
        wordCount: countWords(`${entry.title} ${entry.content}`),
        createdAt: entry.createdAt,
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

import { vi } from "vitest";

import { AgentLogbookService } from "@/backend/service/employee/AgentLogbookService";

import type {
  AgentLogbookFilter,
  NewAgentLogbookEntry,
  StoredAgentLogbookEntry,
  StoredAgentLogbookSettings,
} from "@/backend/database/repositories/employee/AgentLogbookRepository";
import type { AgentLogbookSource } from "@/definition/AgentLogbook";
import type { AgentChatKind } from "@/definition/AgentChatSession";

/** A chat session of the agent `ed` as the store holds it. */
export interface FakeSession {
  readonly sessionId: string;
  readonly kind: AgentChatKind;
  readonly chatId: string;
  readonly chatName: string;
  readonly isConfidential: boolean;
}

/**
 * The entries of the Lagebuch in memory, with the behavior of the repository:
 * insertion order, the ring buffer, the exclusion of the own chat in the hint
 * and of confidential chats everywhere.
 */
export class FakeLogbook {
  public readonly entries: StoredAgentLogbookEntry[] = [];
  public readonly settingsOf = new Map<string, StoredAgentLogbookSettings>();
  public readonly confidential = new Set<string>();
  public readonly participants = new Map<string, string[]>();
  private sequence = 0;

  /** The key of a chat among the confidential ones. */
  public static key(source: Pick<AgentLogbookSource, "kind" | "id">): string {
    return `${source.kind}:${source.id}`;
  }

  public append(entry: NewAgentLogbookEntry): Promise<void> {
    this.sequence += 1;
    this.entries.push({ ...entry, sequence: this.sequence });
    return Promise.resolve();
  }

  public trimToLimit(agentId: string, limit: number): Promise<number> {
    const own = this.entries.filter((entry) => entry.agentId === agentId);
    const dropped = own.slice(0, Math.max(0, own.length - limit));
    for (const entry of dropped)
      this.entries.splice(this.entries.indexOf(entry), 1);
    return Promise.resolve(dropped.length);
  }

  public count(agentId: string): Promise<number> {
    return Promise.resolve(
      this.entries.filter((entry) => entry.agentId === agentId).length,
    );
  }

  public newestSequence(agentId: string): Promise<number> {
    return Promise.resolve(
      Math.max(
        0,
        ...this.entries
          .filter((entry) => entry.agentId === agentId)
          .map((entry) => entry.sequence),
      ),
    );
  }

  public find(
    agentId: string,
    filter: AgentLogbookFilter,
  ): Promise<StoredAgentLogbookEntry[]> {
    const found = this.entries
      .filter((entry) => entry.agentId === agentId)
      .filter((entry) => !this.confidential.has(FakeLogbook.key(entry.source)))
      .filter((entry) => {
        const haystack = [
          entry.text,
          entry.topic,
          entry.source.name,
          ...entry.participants,
        ]
          .join(" ")
          .toLowerCase();
        return filter.words.every((word) =>
          haystack.includes(word.toLowerCase()),
        );
      })
      .filter(
        (entry) =>
          filter.chat === null ||
          entry.source.name.toLowerCase().includes(filter.chat.toLowerCase()),
      )
      .sort((first, second) => second.sequence - first.sequence);
    return Promise.resolve(found.slice(0, filter.limit));
  }

  public ofChat(
    agentId: string,
    source: Pick<AgentLogbookSource, "kind" | "id">,
    limit: number,
  ): Promise<StoredAgentLogbookEntry[]> {
    return Promise.resolve(
      this.entries
        .filter(
          (entry) =>
            entry.agentId === agentId &&
            FakeLogbook.key(entry.source) === FakeLogbook.key(source),
        )
        .sort((first, second) => second.sequence - first.sequence)
        .slice(0, limit),
    );
  }

  public byIds(
    agentId: string,
    ids: readonly string[],
  ): Promise<StoredAgentLogbookEntry[]> {
    return Promise.resolve(
      this.entries.filter(
        (entry) => entry.agentId === agentId && ids.includes(entry.id),
      ),
    );
  }

  public remove(agentId: string, ids: readonly string[]): Promise<number> {
    const doomed = this.entries.filter(
      (entry) => entry.agentId === agentId && ids.includes(entry.id),
    );
    for (const entry of doomed)
      this.entries.splice(this.entries.indexOf(entry), 1);
    return Promise.resolve(doomed.length);
  }

  public removeChat(
    source: Pick<AgentLogbookSource, "kind" | "id">,
    agentId: string | null,
  ): Promise<void> {
    const doomed = this.entries.filter(
      (entry) =>
        FakeLogbook.key(entry.source) === FakeLogbook.key(source) &&
        (agentId === null || entry.agentId === agentId),
    );
    for (const entry of doomed)
      this.entries.splice(this.entries.indexOf(entry), 1);
    return Promise.resolve();
  }

  public newSince(
    agentId: string,
    stand: number,
    own: Pick<AgentLogbookSource, "kind" | "id">,
    topics: number,
  ): Promise<{ count: number; topics: string[] }> {
    const news = this.entries
      .filter(
        (entry) =>
          entry.agentId === agentId &&
          entry.sequence > stand &&
          FakeLogbook.key(entry.source) !== FakeLogbook.key(own) &&
          !this.confidential.has(FakeLogbook.key(entry.source)),
      )
      .sort((first, second) => second.sequence - first.sequence);
    return Promise.resolve({
      count: news.length,
      topics: news.slice(0, topics).map((entry) => entry.topic),
    });
  }

  public participantNames(
    source: Pick<AgentLogbookSource, "kind" | "id">,
  ): Promise<string[]> {
    return Promise.resolve(this.participants.get(FakeLogbook.key(source)) ?? []);
  }

  public settings(agentId: string): Promise<StoredAgentLogbookSettings | null> {
    return Promise.resolve(this.settingsOf.get(agentId) ?? null);
  }

  public saveSettings(
    agentId: string,
    change: {
      limit: number;
      quietMinutes: number;
      model: { connectionId: string; model: string } | null;
    },
  ): Promise<boolean> {
    const current = this.settingsOf.get(agentId);
    if (!current) return Promise.resolve(false);
    this.settingsOf.set(agentId, {
      ...current,
      limit: change.limit,
      quietMinutes: change.quietMinutes,
      connectionId: change.model?.connectionId ?? null,
      model: change.model?.model ?? null,
    });
    return Promise.resolve(true);
  }

  public saveCompactionAt(agentId: string, at: string): Promise<void> {
    const current = this.settingsOf.get(agentId);
    if (current) this.settingsOf.set(agentId, { ...current, compactionAt: at });
    return Promise.resolve();
  }
}

/** The settings of an agent with the defaults of the contract. */
export function settings(
  overrides: Partial<StoredAgentLogbookSettings> = {},
): StoredAgentLogbookSettings {
  return {
    limit: 200,
    quietMinutes: 2,
    connectionId: null,
    model: null,
    compactionAt: null,
    ...overrides,
  };
}

/** The world of the Lagebuch service: its store in memory, the clock and the compaction. */
export interface LogbookWorld {
  readonly service: AgentLogbookService;
  readonly logbook: FakeLogbook;
  readonly sessions: Map<string, FakeSession>;
  readonly seen: Map<string, number>;
  readonly compaction: ReturnType<typeof vi.fn>;
  readonly isLearningEnabled: { value: boolean };
  /** The schedule's "bei vollem Lagebuch" (PAGE-378). */
  readonly isOnFullLogbook: { value: boolean };
  /** Moves the clock; the service reads it for every entry. */
  advance(minutes: number): void;
}

/** A group session of the agent `ed`. */
export const TEAM: FakeSession = {
  sessionId: "session-team",
  kind: "group",
  chatId: "group-team",
  chatName: "Pages-Team",
  isConfidential: false,
};
/** The direct chat of the agent `ed` with Igor. */
export const IGOR: FakeSession = {
  sessionId: "session-igor",
  kind: "direct",
  chatId: "person-igor",
  chatName: "Igor",
  isConfidential: false,
};
/** A second group. */
export const RELEASE: FakeSession = {
  sessionId: "session-release",
  kind: "group",
  chatId: "group-release",
  chatName: "Release",
  isConfidential: false,
};

/** Builds the service on the in-memory store, with the sessions given. */
export function logbookWorld(
  sessions: readonly FakeSession[] = [TEAM, IGOR, RELEASE],
  agentSettings: StoredAgentLogbookSettings = settings(),
): LogbookWorld {
  const logbook = new FakeLogbook();
  logbook.settingsOf.set("ed", agentSettings);
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const seen = new Map<string, number>();
  const compaction = vi.fn(async () => undefined);
  const isLearningEnabled = { value: true };
  const isOnFullLogbook = { value: true };
  let now = new Date("2026-11-13T17:05:00.000Z");
  let counter = 0;
  const service = new AgentLogbookService({
    store: {
      logbook: () => logbook,
      logbookSessions: () => ({
        seen: async (sessionId: string) => seen.get(sessionId) ?? 0,
        saveSeen: async (sessionId: string, sequence: number) => {
          seen.set(sessionId, Math.max(seen.get(sessionId) ?? 0, sequence));
        },
      }),
      chatSessions: () => ({
        find: async (sessionId: string) => sessionMap.get(sessionId) ?? null,
      }),
      chats: () => ({
        isConfidential: async (
          _agentId: string,
          chat: { personId: string },
        ) => logbook.confidential.has(`direct:${chat.personId}`),
        isConfidentialConversation: async (
          _agentId: string,
          conversationId: string,
        ) => logbook.confidential.has(`group:${conversationId}`),
      }),
      employees: () => ({
        find: async () => ({
          isLearningEnabled: isLearningEnabled.value,
          dreamSchedule: { isOnFullLogbook: isOnFullLogbook.value },
        }),
      }),
    } as unknown as ConstructorParameters<typeof AgentLogbookService>[0]["store"],
    compaction,
    now: () => now,
    createId: () => {
      counter += 1;
      return `entry-${String(counter)}`;
    },
  });
  return {
    service,
    logbook,
    sessions: sessionMap,
    seen,
    compaction,
    isLearningEnabled,
    isOnFullLogbook,
    advance: (minutes) => {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
}

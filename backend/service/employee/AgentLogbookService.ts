import { randomUUID } from "node:crypto";

import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import {
  AGENT_LOGBOOK_COMPACTION_PERCENT,
  AGENT_LOGBOOK_READ_LIMITS,
  AGENT_LOGBOOK_TEXT_CHARACTERS,
  AGENT_LOGBOOK_TOPIC_CHARACTERS,
} from "@/definition/AgentLogbook";

import {
  LOGBOOK_READ_SCHEMA,
  LOGBOOK_REMEMBER_SCHEMA,
  LOGBOOK_SEARCH_SCHEMA,
  logbookKindName,
  normalizedLogbookText,
  readLogbookKind,
  searchWords,
  topicOfLogbookText,
} from "./AgentLogbookInput";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentLogbookEntry } from "@/backend/database/repositories/employee/AgentLogbookRepository";
import type {
  AgentLogbookKind,
  AgentLogbookOrigin,
  AgentLogbookSource,
  AgentLogbookTools,
} from "@/definition/AgentLogbook";

const COMPONENT = "AgentLogbookService";

/** How many topics the hint line names at most. */
const HINT_TOPICS = 3;
/** How many people of a chat an entry names at most. */
const PARTICIPANTS = 12;
/** How many recent entries of a chat a new one is compared with, to leave out repeats. */
const DUPLICATE_WINDOW = 100;
/** Minutes after which the compaction is asked for again while the Lagebuch stays full. */
const COMPACTION_COOLDOWN_MINUTES = 60;

/** What the Lagebuch reads and writes. */
export interface AgentLogbookServiceDependencies {
  readonly store: Pick<
    EmployeeStore,
    "logbook" | "logbookSessions" | "chatSessions" | "chats" | "employees"
  >;
  /**
   * Asks for the compaction of an agent (its Dreaming); `null` where no model
   * can run one. The run is the business of the dream service, not of this one.
   */
  readonly compaction: ((agentId: string) => Promise<unknown>) | null;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** The chat session a call of the tools comes from. */
export interface AgentLogbookSession {
  readonly agentId: string;
  readonly sessionId: string;
}

/** A chat an entry comes from. */
export type AgentLogbookChat = AgentLogbookSource;

/** An entry about to be written. */
export interface AgentLogbookDraft {
  readonly kind: AgentLogbookKind;
  readonly text: string;
  /** The short name of the entry; derived from the text when absent. */
  readonly topic?: string;
}

/** What writing entries did. */
export interface AgentLogbookRecorded {
  readonly saved: number;
  /** The chat is confidential, so nothing was written. */
  readonly isConfidential: boolean;
}

/** The hint line of a round and the position the session is told about with it. */
export interface AgentLogbookHint {
  /** `null` when no other chat wrote since the stand of the session. */
  readonly line: string | null;
  /** The sequence of the newest entry; `markSeen` stores it once the round started. */
  readonly newest: number;
}

/** How a chat is named for the agent: a group by its name, a direct chat by its person. */
export function logbookChatLabel(source: AgentLogbookSource): string {
  return source.kind === "group"
    ? `Gruppe „${source.name}“`
    : `Direkt · ${source.name}`;
}

function cut(text: string, maximum: number): string {
  const characters = Array.from(text);
  return characters.length <= maximum
    ? text
    : `${characters.slice(0, maximum - 1).join("")}…`;
}

/** An entry as the tools answer it: no ID, no sequence, in the words of the agent. */
function describeEntry(entry: StoredAgentLogbookEntry): Record<string, unknown> {
  return {
    zeit: entry.createdAt.slice(0, 16).replace("T", " "),
    chat: logbookChatLabel(entry.source),
    art: logbookKindName(entry.kind),
    text: entry.text,
    beteiligte: entry.participants,
    von: entry.origin === "agent" ? "Agent" : "Hintergrund-Zusammenfassung",
  };
}

/**
 * The Lagebuch of an agent: a short memory across all its normal chats
 * (PAGE-377).
 *
 * @remarks
 * Entries come from the agent itself (`lagebuch_merken`) and from the
 * background summary of a quiet chat. Both go through {@link record}, which
 * refuses a confidential chat, leaves out repeats, drops the oldest entries
 * past the limit of the agent (a ring buffer) and asks for the compaction
 * (Dreaming) once the Lagebuch is about 80 % full, when the agent has it
 * switched on. Reading is on demand: `lagebuch_suchen` and `lagebuch_lesen`
 * never reach entries of confidential chats, and a round carries only
 * {@link hint}, one line about what other chats wrote since the stand of its
 * session, never the text of the Lagebuch.
 */
export class AgentLogbookService {
  private readonly dependencies: AgentLogbookServiceDependencies;

  public constructor(dependencies: AgentLogbookServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The tools of one chat session, bound to its agent and its chat.
   *
   * @param session - The agent and the chat session.
   */
  public tools(session: AgentLogbookSession): AgentLogbookTools {
    return {
      remember: (input) => this.remember(session, input),
      search: (input) => this.search(session.agentId, input),
      read: (input) => this.readEntries(session.agentId, input),
    };
  }

  /**
   * Writes entries of a chat into the Lagebuch of an agent.
   *
   * @param agentId - The agent whose Lagebuch it is.
   * @param chat - The chat the entries come from.
   * @param drafts - The entries; repeats of what the chat wrote before are left out.
   * @param origin - Whether the agent or the background summary wrote them.
   */
  public async record(
    agentId: string,
    chat: AgentLogbookChat,
    drafts: readonly AgentLogbookDraft[],
    origin: AgentLogbookOrigin,
  ): Promise<AgentLogbookRecorded> {
    const { store } = this.dependencies;
    if (await this.isConfidential(agentId, chat))
      return { saved: 0, isConfidential: true };
    const logbook = store.logbook();
    const settings = await logbook.settings(agentId);
    if (!settings) return { saved: 0, isConfidential: false };
    const [participants, known] = await Promise.all([
      logbook.participantNames(chat, agentId),
      logbook.ofChat(agentId, chat, DUPLICATE_WINDOW),
    ]);
    const seen = new Set(known.map((entry) => normalizedLogbookText(entry.text)));
    let saved = 0;
    for (const draft of drafts) {
      const text = cut(
        redactCredentials(draft.text.trim()),
        AGENT_LOGBOOK_TEXT_CHARACTERS,
      );
      const key = normalizedLogbookText(text);
      if (text === "" || seen.has(key)) continue;
      seen.add(key);
      await logbook.append({
        id: this.createId(),
        agentId,
        kind: draft.kind,
        text,
        topic: this.topicOf(draft, text),
        source: chat,
        participants: participants.slice(0, PARTICIPANTS),
        origin,
        createdAt: this.now().toISOString(),
      });
      saved += 1;
    }
    if (saved > 0) await this.keepWithinLimit(agentId, settings.limit);
    return { saved, isConfidential: false };
  }

  /**
   * Drops the oldest entries of an agent beyond its limit, such as after the
   * limit was lowered.
   *
   * @returns How many entries dropped out.
   */
  public async trim(agentId: string): Promise<number> {
    const logbook = this.dependencies.store.logbook();
    const settings = await logbook.settings(agentId);
    return settings ? logbook.trimToLimit(agentId, settings.limit) : 0;
  }

  /**
   * The hint line of the next round of a chat session: how many entries other
   * chats wrote since the session was told last, with the topics of the
   * newest. A session that has seen everything gets no line.
   *
   * @param session - The agent and the chat session of the round.
   */
  public async hint(session: AgentLogbookSession): Promise<AgentLogbookHint> {
    const { store } = this.dependencies;
    const [chat, newest, stand] = await Promise.all([
      store.chatSessions().find(session.sessionId),
      store.logbook().newestSequence(session.agentId),
      store.logbookSessions().seen(session.sessionId),
    ]);
    if (!chat || newest <= stand) return { line: null, newest };
    const news = await store
      .logbook()
      .newSince(
        session.agentId,
        stand,
        { kind: chat.kind, id: chat.chatId },
        HINT_TOPICS,
      );
    if (news.count === 0) return { line: null, newest };
    const topics = [...new Set(news.topics)];
    const more = news.count > topics.length ? ", …" : "";
    const noun = news.count === 1 ? "neuer Eintrag" : "neue Einträge";
    return {
      line: `Lagebuch: ${String(news.count)} ${noun} (${topics.join(", ")}${more})`,
      newest,
    };
  }

  /**
   * Records that a session was told about the entries up to a sequence.
   *
   * @param sessionId - The chat session whose round started.
   * @param newest - The `newest` of the hint the round carried.
   */
  public async markSeen(sessionId: string, newest: number): Promise<void> {
    if (newest <= 0) return;
    await this.dependencies.store.logbookSessions().saveSeen(sessionId, newest);
  }

  private async remember(
    session: AgentLogbookSession,
    input: unknown,
  ): Promise<unknown> {
    const parsed = LOGBOOK_REMEMBER_SCHEMA.safeParse(input);
    const kind = parsed.success ? readLogbookKind(parsed.data.art) : null;
    if (!parsed.success || kind === null)
      return {
        gespeichert: false,
        grund:
          "art muss entscheidung, aufgabe, fakt, frage oder notiz sein; text ist nötig und höchstens 500 Zeichen lang.",
      };
    const chat = await this.dependencies.store
      .chatSessions()
      .find(session.sessionId);
    if (!chat)
      return {
        gespeichert: false,
        grund: "Dieser Lauf gehört zu keinem Chat und schreibt nicht ins Lagebuch.",
      };
    const source: AgentLogbookChat = {
      kind: chat.kind,
      id: chat.chatId,
      name: chat.chatName,
    };
    const recorded = await this.record(
      session.agentId,
      source,
      [{ kind, text: parsed.data.text }],
      "agent",
    );
    if (recorded.isConfidential)
      return {
        gespeichert: false,
        grund:
          "Dieser Chat ist vertraulich: Aus ihm schreibt Pages nichts ins gemeinsame Lagebuch.",
      };
    if (recorded.saved === 0)
      return {
        gespeichert: false,
        grund: "Ein gleicher Eintrag aus diesem Chat steht schon im Lagebuch.",
      };
    return {
      gespeichert: true,
      art: logbookKindName(kind),
      chat: logbookChatLabel(source),
    };
  }

  private async search(agentId: string, input: unknown): Promise<unknown> {
    const parsed = LOGBOOK_SEARCH_SCHEMA.safeParse(input);
    if (!parsed.success)
      return { eintraege: [], hinweis: "text ist nötig: ein paar Suchwörter." };
    const entries = await this.dependencies.store.logbook().find(agentId, {
      words: searchWords(parsed.data.text),
      chat: null,
      limit: AGENT_LOGBOOK_READ_LIMITS.search,
    });
    return this.answer(entries);
  }

  private async readEntries(agentId: string, input: unknown): Promise<unknown> {
    const parsed = LOGBOOK_READ_SCHEMA.safeParse(input);
    if (!parsed.success)
      return { eintraege: [], hinweis: "chat und thema sind Texte." };
    const chat = parsed.data.chat ?? "";
    const entries = await this.dependencies.store.logbook().find(agentId, {
      words: searchWords(parsed.data.thema),
      chat: chat === "" ? null : chat,
      limit: AGENT_LOGBOOK_READ_LIMITS.read,
    });
    return this.answer(entries);
  }

  private answer(entries: readonly StoredAgentLogbookEntry[]): unknown {
    if (entries.length === 0)
      return { eintraege: [], hinweis: "Keine passenden Einträge im Lagebuch." };
    return { eintraege: entries.map(describeEntry) };
  }

  /** A chat is confidential when its direct chat or its conversation is marked so. */
  private async isConfidential(
    agentId: string,
    chat: AgentLogbookChat,
  ): Promise<boolean> {
    const chats = this.dependencies.store.chats();
    return chat.kind === "direct"
      ? chats.isConfidential(agentId, { kind: "person", personId: chat.id })
      : chats.isConfidentialConversation(agentId, chat.id);
  }

  private topicOf(draft: AgentLogbookDraft, text: string): string {
    const given = draft.topic?.trim() ?? "";
    return given === ""
      ? topicOfLogbookText(text)
      : cut(redactCredentials(given), AGENT_LOGBOOK_TOPIC_CHARACTERS);
  }

  /** The ring buffer: the oldest entries past the limit drop out, then the compaction is asked for at 80 %. */
  private async keepWithinLimit(agentId: string, limit: number): Promise<void> {
    const logbook = this.dependencies.store.logbook();
    await logbook.trimToLimit(agentId, limit);
    const count = await logbook.count(agentId);
    if ((count / limit) * 100 >= AGENT_LOGBOOK_COMPACTION_PERCENT)
      await this.requestCompaction(agentId);
  }

  /**
   * Asks for the compaction (Dreaming) of an agent that has it switched on,
   * not more often than the cooldown allows.
   */
  private async requestCompaction(agentId: string): Promise<void> {
    const { compaction, store } = this.dependencies;
    if (!compaction) return;
    const [employee, settings] = await Promise.all([
      store.employees().find(agentId),
      store.logbook().settings(agentId),
    ]);
    // The schedule decides: the dream run must be on and ask for a full Lagebuch (PAGE-378).
    if (
      !employee?.isLearningEnabled ||
      !employee.dreamSchedule.isOnFullLogbook ||
      !settings
    )
      return;
    const now = this.now();
    const last = settings.compactionAt;
    if (
      last !== null &&
      now.getTime() - new Date(last).getTime() <
        COMPACTION_COOLDOWN_MINUTES * 60_000
    )
      return;
    await store.logbook().saveCompactionAt(agentId, now.toISOString());
    void compaction(agentId).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
  }

  private createId(): string {
    return this.dependencies.createId?.() ?? randomUUID();
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}

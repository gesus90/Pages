import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import {
  isSameChat,
  parseMemoryDocument,
  renderTopic,
  topicKey,
} from "./AgentMemoryDocument";

import type {
  ChatSessionRepository,
  StoredChatMessage,
} from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentMemoryChat } from "@/definition/AgentMemory";
import type { User } from "@/definition/User";
import type {
  AgentMemoryDocument,
  AgentMemoryEntry,
} from "./AgentMemoryDocument";
import type { AgentMemoryModel } from "./AgentMemoryModel";
import type { AgentTopicUpdate } from "./AgentMemoryPrompt";
import type { AgentMemoryService } from "./AgentMemoryService";

/** Messages of a chat session from which its older part is summarized. */
const SUMMARY_FROM_MESSAGES = 24;
/** Newest messages a summary leaves out, so they stay in the history. */
const RETAINED_MESSAGES = 10;

/** One answer of an agent in a chat, as the memory records it. */
export interface AgentAnswerRecord {
  readonly agent: User;
  readonly chat: AgentMemoryChat;
  /** How the source names the chat, such as `Chat mit Igor`. */
  readonly chatLabel: string;
  readonly personName: string;
  readonly message: string;
  readonly answer: string;
  /** The chat session of the agent whose long history is summarized; `null` for none. */
  readonly sessionId: string | null;
}

/** What the recorder uses. */
export interface AgentMemoryRecorderDependencies {
  readonly store: EmployeeStore;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly memory: Pick<AgentMemoryService, "updateMemory">;
  /** The model calls; the simulation replaces them. */
  readonly model: AgentMemoryModel;
  readonly today?: () => string;
}

function applyTopics(
  current: AgentMemoryDocument,
  updates: readonly AgentTopicUpdate[],
  record: AgentAnswerRecord,
  today: string,
): {
  readonly document: AgentMemoryDocument;
  readonly finished: readonly AgentMemoryEntry[];
} {
  const entries = [...current.entries];
  const finished: AgentMemoryEntry[] = [];
  for (const update of updates) {
    const index = entries.findIndex(
      (entry) =>
        isSameChat(entry.source.chat, record.chat) &&
        topicKey(entry.title) === topicKey(update.title),
    );
    const entry = renderTopic({
      title: update.title,
      about: update.about,
      status: update.status,
      nextStep: update.nextStep,
      source: {
        chat: record.chat,
        tickets: update.tickets,
        wikiPages: update.wikiPages,
      },
      chatLabel: record.chatLabel,
      date: today,
    });
    if (update.isDone) {
      if (index >= 0) entries.splice(index, 1);
      finished.push(entry);
    } else if (index >= 0) entries[index] = entry;
    else entries.push(entry);
  }
  return { document: { preamble: current.preamble, entries }, finished };
}

/** The messages a new summary takes in: after the old one, before the retained ones. */
function summaryRange(
  transcript: readonly StoredChatMessage[],
  throughId: string | null,
): readonly StoredChatMessage[] {
  if (transcript.length < SUMMARY_FROM_MESSAGES) return [];
  const older = transcript.slice(0, -RETAINED_MESSAGES);
  const boundary =
    throughId === null
      ? -1
      : older.findIndex((message) => message.id === throughId);
  return older.slice(boundary + 1);
}

/**
 * Keeps the memory of an agent current after each answer (PAGE-305).
 *
 * @remarks
 * After every answer in a chat that is not confidential the model names
 * the topics the exchange brings or changes; Pages writes them into
 * `MEMORY.md` at once, one entry per topic with its source and date, and
 * moves finished and, beyond the limit, the oldest topics into the
 * archive. A long chat gets a summary of its older part. Updates of one
 * agent run one after the other, apart from its answers; a failure leaves
 * the memory as it was.
 */
export class AgentMemoryRecorder {
  private readonly dependencies: AgentMemoryRecorderDependencies;
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(dependencies: AgentMemoryRecorderDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Records an answer in the background.
   *
   * @returns The end of this update, for callers that wait for it; it never rejects.
   */
  public record(record: AgentAnswerRecord): Promise<void> {
    const agentId = record.agent.id;
    const previous = this.queues.get(agentId) ?? Promise.resolve();
    const next = previous.then(() =>
      withBackgroundDatabaseWork("agent_memory_update", () =>
        this.update(record),
      ).catch((error: unknown) => {
        logCaughtError("AgentMemoryRecorder", error);
      }),
    );
    this.queues.set(agentId, next);
    void next.finally(() => {
      if (this.queues.get(agentId) === next) this.queues.delete(agentId);
    });
    return next;
  }

  private async update(record: AgentAnswerRecord): Promise<void> {
    const { store, memory, model } = this.dependencies;
    const agentId = record.agent.id;
    // Nothing of a confidential chat reaches the memory.
    if (await store.chats().isConfidential(agentId, record.chat)) return;
    const employee = await store.employees().find(agentId);
    if (!employee || record.answer.trim() === "") return;
    const caller = { agent: record.agent, employee };
    const topics = parseMemoryDocument(employee.memory).entries.filter(
      (entry) => isSameChat(entry.source.chat, record.chat),
    );
    const updates = await model.topics(caller, {
      topics: topics.map(({ title, text }) => ({ title, text })),
      exchange: {
        personName: record.personName,
        message: record.message,
        answer: record.answer,
      },
    });
    const today = this.today();
    const archived =
      updates && updates.length > 0
        ? await memory.updateMemory(agentId, (current) =>
            applyTopics(current, updates, record, today),
          )
        : 0;
    logEvent({
      level: "info",
      event: "agent.memory.updated",
      component: "AgentMemoryRecorder",
      message: "Agent memory updated after an answer",
      metadata: { count: updates?.length ?? 0, deleted: archived ?? 0 },
    });
    if (record.sessionId !== null)
      await this.summarize(caller, record.sessionId);
  }

  /** Summarizes the older part of a long chat session. */
  private async summarize(
    caller: Parameters<AgentMemoryModel["summarize"]>[0],
    sessionId: string,
  ): Promise<void> {
    const { store, messages, model } = this.dependencies;
    const [transcript, stored] = await Promise.all([
      messages.messages(sessionId),
      store.chats().summary(sessionId),
    ]);
    const range = summaryRange(transcript, stored?.throughId ?? null);
    const last = range.at(-1);
    if (!last) return;
    const summary = await model.summarize(caller, {
      previous: stored?.summary ?? null,
      messages: range.map((message) => ({
        from: message.role === "user" ? "person" : caller.agent.displayName,
        text: message.content,
      })),
    });
    if (summary === null) return;
    await store.chats().saveSummary(sessionId, { summary, throughId: last.id });
  }

  private today(): string {
    return this.dependencies.today?.() ?? new Date().toISOString().slice(0, 10);
  }
}

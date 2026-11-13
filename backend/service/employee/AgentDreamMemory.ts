import { isSameChat, renderTopic, topicKey } from "./AgentMemoryDocument";

import type { StoredAgentLogbookEntry } from "@/backend/database/repositories/employee/AgentLogbookRepository";
import type { AgentDreamLogEntry } from "@/definition/AgentDreaming";
import type { AgentMemoryChat } from "@/definition/AgentMemory";
import type { AgentDreamAnswer, AgentDreamTopic } from "./AgentLearningPrompt";
import type {
  AgentMemoryDocument,
  AgentMemoryEntry,
} from "./AgentMemoryDocument";
import type { AgentMemoryService } from "./AgentMemoryService";

/** Characters of a discarded Lagebuch entry the log names. */
const DISCARD_CHARACTERS = 90;

/** A topic of the dream run with the chat it comes from. */
interface SourcedTopic {
  readonly topic: AgentDreamTopic;
  readonly chat: AgentMemoryChat;
  readonly chatLabel: string;
}

/** What taking the Lagebuch into `MEMORY.md` did. */
export interface AgentDreamMemoryOutcome {
  readonly log: readonly AgentDreamLogEntry[];
  /** Topics that moved into the archive because `MEMORY.md` was full. */
  readonly archived: number;
}

function chatOf(entry: StoredAgentLogbookEntry): SourcedTopic["chat"] {
  return entry.source.kind === "direct"
    ? { kind: "person", personId: entry.source.id }
    : { kind: "conversation", conversationId: entry.source.id };
}

function labelOf(entry: StoredAgentLogbookEntry): string {
  return entry.source.kind === "direct"
    ? `Chat mit ${entry.source.name}`
    : `Gruppe „${entry.source.name}“`;
}

/**
 * The topics that name an entry of the Lagebuch they rest on; the first entry
 * names the chat, whose rules of sharing then apply to the topic. A topic
 * without a valid entry has no source and is left out.
 */
function sourced(
  topics: readonly AgentDreamTopic[],
  logbook: readonly StoredAgentLogbookEntry[],
): SourcedTopic[] {
  return topics.flatMap((topic) => {
    const entry = topic.entries
      .map((number) => logbook[number - 1])
      .find((candidate) => candidate !== undefined);
    return entry
      ? [{ topic, chat: chatOf(entry), chatLabel: labelOf(entry) }]
      : [];
  });
}

function applyTopics(
  current: AgentMemoryDocument,
  topics: readonly SourcedTopic[],
  today: string,
): {
  readonly document: AgentMemoryDocument;
  readonly finished: readonly AgentMemoryEntry[];
} {
  const entries = [...current.entries];
  const finished: AgentMemoryEntry[] = [];
  for (const { topic, chat, chatLabel } of topics) {
    const index = entries.findIndex(
      (entry) =>
        isSameChat(entry.source.chat, chat) &&
        topicKey(entry.title) === topicKey(topic.title),
    );
    const entry = renderTopic({
      title: topic.title,
      about: topic.about,
      status: topic.status,
      nextStep: topic.nextStep,
      source: { chat, tickets: topic.tickets, wikiPages: topic.wikiPages },
      chatLabel,
      date: today,
    });
    if (topic.isDone) {
      if (index >= 0) entries.splice(index, 1);
      finished.push(entry);
    } else if (index >= 0) entries[index] = entry;
    else entries.push(entry);
  }
  return { document: { preamble: current.preamble, entries }, finished };
}

function describeDiscarded(
  discarded: readonly number[],
  logbook: readonly StoredAgentLogbookEntry[],
): AgentDreamLogEntry[] {
  return [...new Set(discarded)].flatMap((number) => {
    const entry = logbook[number - 1];
    if (!entry) return [];
    const text = Array.from(entry.text).slice(0, DISCARD_CHARACTERS).join("");
    return [
      {
        kind: "memoryDropped" as const,
        text: `${text} (erledigt oder veraltet)`,
      },
    ];
  });
}

/**
 * Takes the durable points of the Lagebuch into `MEMORY.md` (PAGE-378): one
 * topic each with its source and date, finished topics into the archive, and
 * names what was discarded as done or outdated.
 *
 * @param memory - Changes `MEMORY.md` within its limit.
 * @param input - The agent, what the run answered and the Lagebuch entries it numbered.
 */
export async function takeIntoMemory(
  memory: Pick<AgentMemoryService, "updateMemory">,
  input: {
    readonly agentId: string;
    readonly answer: Pick<AgentDreamAnswer, "topics" | "discarded">;
    readonly logbook: readonly StoredAgentLogbookEntry[];
    /** `YYYY-MM-DD`. */
    readonly today: string;
  },
): Promise<AgentDreamMemoryOutcome> {
  const topics = sourced(input.answer.topics, input.logbook);
  const log: AgentDreamLogEntry[] = topics.map(({ topic }) => ({
    kind: topic.isDone ? "memoryDropped" : "memoryTaken",
    text: topic.isDone ? `${topic.title} (erledigt)` : topic.title,
  }));
  log.push(...describeDiscarded(input.answer.discarded, input.logbook));
  if (topics.length === 0) return { log, archived: 0 };
  const archived = await memory.updateMemory(input.agentId, (current) =>
    applyTopics(current, topics, input.today),
  );
  return { log, archived: archived ?? 0 };
}

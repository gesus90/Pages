import { countCharacters } from "@/definition/AgentMemory";

import type {
  AgentMemoryChat,
  AgentMemorySource,
} from "@/definition/AgentMemory";

/** Characters of one field of a topic. */
const FIELD_CHARACTERS = 400;
/** Characters of the title of a topic. */
const TITLE_CHARACTERS = 120;
const TICKET_LINK = /\(\/tasks\/([A-Z][A-Z0-9]*-\d+)\)/gu;
const WIKI_LINK = /\(\/wiki\/([A-Za-z0-9-]+)\)/gu;
const CHAT_LINK = /\(chat:(person|conversation)\/([A-Za-z0-9-]+)\)/u;
const DATE = /^- Datum:\s*(\d{4}-\d{2}-\d{2})\s*$/mu;
const SOURCE_LINE = /^- Quelle:(.*)$/mu;

/** One topic of `MEMORY.md` as Pages writes it. */
export interface AgentMemoryTopic {
  readonly title: string;
  /** What the topic is about. */
  readonly about: string;
  /** Where it stands. */
  readonly status: string;
  readonly nextStep: string;
  readonly source: AgentMemorySource;
  /** The names of the source links, such as `Chat mit Igor`. */
  readonly chatLabel: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

/** One entry of `MEMORY.md`: a block that starts with a `## ` heading. */
export interface AgentMemoryEntry {
  readonly title: string;
  /** The whole block as stored, heading included. */
  readonly text: string;
  readonly source: AgentMemorySource;
  /** `YYYY-MM-DD`, or `null` when the block names no date. */
  readonly date: string | null;
}

/** `MEMORY.md` split into the free text before the first topic and the topics. */
export interface AgentMemoryDocument {
  readonly preamble: string;
  readonly entries: readonly AgentMemoryEntry[];
}

function cut(text: string, maximum: number): string {
  const single = text.replace(/\s+/gu, " ").trim();
  const characters = Array.from(single);
  return characters.length <= maximum
    ? single
    : `${characters.slice(0, maximum - 1).join("")}…`;
}

function chatOf(sourceLine: string): AgentMemoryChat | null {
  const match = CHAT_LINK.exec(sourceLine);
  if (!match) return null;
  const [, kind, id] = match;
  if (id === undefined) return null;
  return kind === "person"
    ? { kind: "person", personId: id }
    : { kind: "conversation", conversationId: id };
}

/**
 * Reads the source of a topic block from its line `- Quelle:`.
 *
 * @param block - The Markdown of one topic.
 * @returns The chat, ticket keys and wiki pages its links name.
 */
export function readEntrySource(block: string): AgentMemorySource {
  const line = SOURCE_LINE.exec(block)?.[1] ?? "";
  return {
    chat: chatOf(line),
    tickets: [
      ...new Set([...line.matchAll(TICKET_LINK)].map((match) => match[1])),
    ].filter((key): key is string => key !== undefined),
    wikiPages: [
      ...new Set([...line.matchAll(WIKI_LINK)].map((match) => match[1])),
    ].filter((id): id is string => id !== undefined),
  };
}

/** The link target of a chat in a source line. */
export function chatLink(chat: AgentMemoryChat): string {
  return chat.kind === "person"
    ? `chat:person/${chat.personId}`
    : `chat:conversation/${chat.conversationId}`;
}

/** Whether two chats are the same chat. */
export function isSameChat(
  left: AgentMemoryChat | null,
  right: AgentMemoryChat | null,
): boolean {
  if (left === null || right === null) return false;
  if (left.kind === "person" && right.kind === "person")
    return left.personId === right.personId;
  if (left.kind === "conversation" && right.kind === "conversation")
    return left.conversationId === right.conversationId;
  return false;
}

/**
 * Splits `MEMORY.md` into its free text and its topics.
 *
 * @param text - The stored `MEMORY.md`.
 * @returns Every block that starts with `## ` as a topic, in stored order.
 */
export function parseMemoryDocument(text: string): AgentMemoryDocument {
  const normalized = text.replace(/\r\n/gu, "\n");
  const parts = normalized.split(/^(?=## )/mu);
  const first = parts[0] ?? "";
  const hasPreamble = !first.startsWith("## ");
  const blocks = hasPreamble ? parts.slice(1) : parts;
  return {
    preamble: hasPreamble ? first.trim() : "",
    entries: blocks
      .map((block) => block.trim())
      .filter((block) => block !== "")
      .map((block) => ({
        title: (block.split("\n", 1)[0] ?? "").replace(/^## /u, "").trim(),
        text: block,
        source: readEntrySource(block),
        date: DATE.exec(block)?.[1] ?? null,
      })),
  };
}

/** Joins the free text and the topics back into `MEMORY.md`. */
export function renderMemoryDocument(document: AgentMemoryDocument): string {
  return [document.preamble, ...document.entries.map((entry) => entry.text)]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

/**
 * Writes one topic in the fixed form of `MEMORY.md`: what it is about,
 * where it stands, the next step, its source as links and its date.
 */
export function renderTopic(topic: AgentMemoryTopic): AgentMemoryEntry {
  const links = [
    ...(topic.source.chat
      ? [`[${cut(topic.chatLabel, 80)}](${chatLink(topic.source.chat)})`]
      : []),
    ...topic.source.tickets.map((key) => `[${key}](/tasks/${key})`),
    ...topic.source.wikiPages.map((id) => `[Wiki-Seite](/wiki/${id})`),
  ];
  const title = cut(topic.title, TITLE_CHARACTERS);
  const text = [
    `## ${title}`,
    `- Worum es geht: ${cut(topic.about, FIELD_CHARACTERS)}`,
    `- Stand: ${cut(topic.status, FIELD_CHARACTERS)}`,
    `- Nächster Schritt: ${cut(topic.nextStep, FIELD_CHARACTERS) || "–"}`,
    `- Quelle: ${links.join(" · ") || "–"}`,
    `- Datum: ${topic.date}`,
  ].join("\n");
  return { title, text, source: topic.source, date: topic.date };
}

/** The key under which a topic of one chat is updated rather than added. */
export function topicKey(title: string): string {
  return title.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

/**
 * Keeps `MEMORY.md` within its character limit.
 *
 * @param document - The topics after an update.
 * @param maximum - The character limit of the agent.
 * @returns The document that fits and the topics that move into the archive,
 * the oldest first; the free text is cut only when it alone exceeds the limit.
 */
export function fitMemoryDocument(
  document: AgentMemoryDocument,
  maximum: number,
): {
  readonly document: AgentMemoryDocument;
  readonly moved: readonly AgentMemoryEntry[];
} {
  const preamble =
    countCharacters(document.preamble) > maximum
      ? cut(document.preamble, maximum)
      : document.preamble;
  // The oldest topics leave first; a topic without a date counts as oldest.
  const byAge = document.entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        (left.entry.date ?? "").localeCompare(right.entry.date ?? "") ||
        left.index - right.index,
    );
  const kept = new Set(document.entries);
  const moved: AgentMemoryEntry[] = [];
  const size = (): number =>
    countCharacters(
      renderMemoryDocument({
        preamble,
        entries: document.entries.filter((entry) => kept.has(entry)),
      }),
    );
  for (const { entry } of byAge) {
    if (size() <= maximum) break;
    kept.delete(entry);
    moved.push(entry);
  }
  return {
    document: {
      preamble,
      entries: document.entries.filter((entry) => kept.has(entry)),
    },
    moved,
  };
}

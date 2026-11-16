import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { AGENT_HISTORY_LIMITS } from "@/definition/AgentChatHistory";

import type {
  AgentChatHistoryRepository,
  StoredHistoryMessage,
} from "@/backend/database/repositories/conversation/AgentChatHistoryRepository";
import type {
  AgentChatHistory,
  AgentHistoryChat,
  AgentHistoryCurrentChat,
  AgentHistoryExcerpt,
  AgentHistoryHit,
  AgentHistoryRead,
  AgentHistorySearch,
} from "@/definition/AgentChatHistory";

/** What the history search reads. */
export interface AgentChatHistoryDependencies {
  readonly history: Pick<AgentChatHistoryRepository, "search" | "around">;
}

/** How many more rows a search reads than it returns, for the hits dropped after redaction. */
const READ_AHEAD = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** The words of a search: split at white space, without duplicates, at most the limit. */
export function historyWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  return [...new Set(words)].slice(0, AGENT_HISTORY_LIMITS.words);
}

/** The start of a day in UTC, or `null` for an absent or malformed day. */
function dayStart(day: string | undefined): string | null {
  if (day === undefined || !DAY.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** The start of the day after a day in UTC, so the day itself is included. */
function dayAfter(day: string | undefined): string | null {
  const start = dayStart(day);
  if (start === null) return null;
  return new Date(Date.parse(start) + 86_400_000).toISOString();
}

function bounded(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : `${characters.slice(0, limit).join("")} …`;
}

/**
 * A short part of a text around the first of the words, with "…" where it
 * was cut.
 */
export function historySnippet(text: string, words: readonly string[]): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const limit = AGENT_HISTORY_LIMITS.snippetCharacters;
  if (flat.length <= limit) return flat;
  const lower = flat.toLowerCase();
  const found = words
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0);
  const first = found.length === 0 ? 0 : Math.min(...found);
  const start = Math.max(0, Math.min(first - limit / 3, flat.length - limit));
  const end = Math.min(flat.length, start + limit);
  return `${start > 0 ? "… " : ""}${flat.slice(start, end).trim()}${end < flat.length ? " …" : ""}`;
}

/** Whether every word still appears after the credentials were masked. */
function matchesAll(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/** Whether a message belongs to the chat of the job. */
function isThisChat(
  message: Pick<StoredHistoryMessage, "chatKind" | "chatId" | "conversationId">,
  current: AgentHistoryCurrentChat | null,
): boolean {
  if (!current) return false;
  if (current.kind === "direct")
    return message.chatKind === "direct" && message.chatId === current.personId;
  return message.conversationId === current.conversationId;
}

/**
 * The "Zur Nachricht" link of a message: the chat page opens the
 * chat of the person reading it and shows the message.
 *
 * @remarks
 * The person of a direct chat reads it under the agent, a group is read
 * under its ID. Pages offers the link only inside the chat the message
 * belongs to.
 */
export function historyMessageLink(
  agentId: string,
  message: Pick<StoredHistoryMessage, "chatKind" | "chatId" | "messageId">,
): string {
  const parameters = new URLSearchParams(
    message.chatKind === "direct"
      ? { kind: "participant", id: agentId, message: message.messageId }
      : { kind: "group", id: message.chatId, message: message.messageId },
  );
  return `/chat?${parameters.toString()}`;
}

function chatOf(message: StoredHistoryMessage): AgentHistoryChat {
  return { kind: message.chatKind, id: message.chatId, name: message.chatName };
}

/** A whole number within its bounds, or the default. */
function count(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback;
  return Math.min(Math.max(value, 0), maximum);
}

/**
 * The history search of chat agents: `verlauf_durchsuchen` finds
 * earlier messages of the agent's chats, `verlauf_lesen` reads the messages
 * around one of them.
 *
 * @remarks
 * The repository decides what is visible: only chats the agent is a member
 * of now, a confidential chat only from inside itself, no deleted message
 * and no dissolved group. Every text leaves masked; a message found only
 * through a credential is dropped, so the search cannot probe for one.
 */
export class AgentChatHistoryService {
  private readonly dependencies: AgentChatHistoryDependencies;

  public constructor(dependencies: AgentChatHistoryDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Binds the history tools to the agent and the chat of one job.
   *
   * @param agentId - The agent of the job.
   * @param current - The chat the job runs in; `null` for a run without a chat.
   */
  public bind(
    agentId: string,
    current: AgentHistoryCurrentChat | null,
  ): AgentChatHistory {
    return {
      search: (input) => this.search(agentId, current, input),
      read: (input) => this.read(agentId, current, input),
    };
  }

  private async search(
    agentId: string,
    current: AgentHistoryCurrentChat | null,
    input: AgentHistorySearch,
  ): Promise<readonly AgentHistoryHit[]> {
    const words = historyWords(input.query);
    if (words.length === 0) return [];
    const limit = count(
      input.limit,
      AGENT_HISTORY_LIMITS.hitsDefault,
      AGENT_HISTORY_LIMITS.hitsMaximum,
    );
    const chat = input.chat?.trim() ?? "";
    const from = input.from?.trim() ?? "";
    const stored = await this.dependencies.history.search(agentId, current, {
      words,
      chat: chat === "" ? null : chat,
      sender: from === "" ? null : from,
      since: dayStart(input.since),
      before: dayAfter(input.until),
      limit: Math.max(limit, 1) * READ_AHEAD,
    });
    return stored
      .map((message) => ({ message, text: redactCredentials(message.text) }))
      .filter(({ text }) => matchesAll(text, words))
      .slice(0, limit)
      .map(({ message, text }) => {
        const isThis = isThisChat(message, current);
        return {
          messageId: message.messageId,
          chat: chatOf(message),
          from: message.senderName,
          at: message.createdAt,
          snippet: historySnippet(text, words),
          isThisChat: isThis,
          link: isThis ? historyMessageLink(agentId, message) : null,
        };
      });
  }

  private async read(
    agentId: string,
    current: AgentHistoryCurrentChat | null,
    input: AgentHistoryRead,
  ): Promise<AgentHistoryExcerpt | null> {
    const found = await this.dependencies.history.around(agentId, current, {
      messageId: input.messageId,
      before: count(
        input.before,
        AGENT_HISTORY_LIMITS.aroundDefault,
        AGENT_HISTORY_LIMITS.aroundMaximum,
      ),
      after: count(
        input.after,
        AGENT_HISTORY_LIMITS.aroundDefault,
        AGENT_HISTORY_LIMITS.aroundMaximum,
      ),
    });
    if (!found) return null;
    const isThis = isThisChat(found.hit, current);
    return {
      chat: chatOf(found.hit),
      isThisChat: isThis,
      messages: found.messages.map((message) => ({
        messageId: message.messageId,
        from: message.senderName,
        at: message.createdAt,
        text: bounded(
          redactCredentials(message.text),
          AGENT_HISTORY_LIMITS.messageCharacters,
        ),
        isHit: message.messageId === found.hit.messageId,
        link: isThis ? historyMessageLink(agentId, message) : null,
      })),
    };
  }
}

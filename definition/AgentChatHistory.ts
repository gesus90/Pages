/**
 * Contracts of the history search of chat agents (PAGE-393).
 *
 * @remarks
 * An agent searches the earlier messages of the chats it is a member of now,
 * also far outside its current context ("Was hatten wir letzten Monat zur
 * Ruhezeit entschieden?"), and reads a hit with the messages around it. The
 * search complements the Lagebuch (PAGE-377). A confidential chat is found
 * only from inside itself; deleted messages and dissolved groups are gone.
 */

/** The bounds of the two tools. */
export const AGENT_HISTORY_LIMITS = {
  /** Hits of one search while the agent names no other number. */
  hitsDefault: 10,
  /** Most hits of one search. */
  hitsMaximum: 20,
  /** Most words a search uses; all of them must appear in a message. */
  words: 8,
  /** Longest search text, in characters. */
  queryCharacters: 200,
  /** Characters of the snippet of a hit. */
  snippetCharacters: 240,
  /** Messages before and after a hit while the agent names no other number. */
  aroundDefault: 5,
  /** Most messages before and after a hit. */
  aroundMaximum: 10,
  /** Longest text of one message of an excerpt, in characters. */
  messageCharacters: 2_000,
} as const;

/** The chat a job of an agent runs in: a direct chat with a person or a stored conversation. */
export type AgentHistoryCurrentChat =
  | { readonly kind: "direct"; readonly personId: string }
  | { readonly kind: "conversation"; readonly conversationId: string };

/** The chat a message belongs to, as the agent sees it. */
export interface AgentHistoryChat {
  /** `direct` for a chat with one person, `group` for a group. */
  readonly kind: "direct" | "group";
  /** The person of a direct chat, the conversation of a group. */
  readonly id: string;
  readonly name: string;
}

/** One hit of `verlauf_durchsuchen`. */
export interface AgentHistoryHit {
  /** The message; `verlauf_lesen` reads around it. */
  readonly messageId: string;
  readonly chat: AgentHistoryChat;
  readonly from: string;
  /** ISO time the message was written. */
  readonly at: string;
  readonly snippet: string;
  /** Whether the message belongs to the chat this job runs in. */
  readonly isThisChat: boolean;
  /** The "Zur Nachricht" link, only for a message of this chat; otherwise `null`. */
  readonly link: string | null;
}

/** One message of an excerpt of `verlauf_lesen`. */
export interface AgentHistoryMessage {
  readonly messageId: string;
  readonly from: string;
  readonly at: string;
  readonly text: string;
  /** Whether this is the message the excerpt was read around. */
  readonly isHit: boolean;
  readonly link: string | null;
}

/** The excerpt around one hit. */
export interface AgentHistoryExcerpt {
  readonly chat: AgentHistoryChat;
  readonly isThisChat: boolean;
  readonly messages: readonly AgentHistoryMessage[];
}

/** What `verlauf_durchsuchen` looks for. */
export interface AgentHistorySearch {
  readonly query: string;
  /** A part of the chat name or the ID of a chat; absent for every chat. */
  readonly chat?: string;
  /** A part of the sender's name; absent for every sender. */
  readonly from?: string;
  /** The first day, `YYYY-MM-DD` in UTC, inclusive. */
  readonly since?: string;
  /** The last day, `YYYY-MM-DD` in UTC, inclusive. */
  readonly until?: string;
  readonly limit?: number;
}

/** What `verlauf_lesen` reads. */
export interface AgentHistoryRead {
  readonly messageId: string;
  readonly before?: number;
  readonly after?: number;
}

/**
 * The history tools of one job, bound to its agent and chat (PAGE-393).
 *
 * @remarks
 * Pages binds the agent and the chat from the job, never from model input.
 */
export interface AgentChatHistory {
  search(input: AgentHistorySearch): Promise<readonly AgentHistoryHit[]>;
  /** Returns `null` when the message is not visible to the job (missing, deleted or hidden). */
  read(input: AgentHistoryRead): Promise<AgentHistoryExcerpt | null>;
}

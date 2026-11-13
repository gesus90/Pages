/**
 * Contracts of the Lagebuch of an agent (PAGE-377).
 *
 * @remarks
 * An agent keeps one session per chat, so it would not know what happens in
 * its other chats. The Lagebuch is one short, shared memory across all its
 * normal chats: entries of five kinds, each with time, source chat and the
 * people involved. It is read only on demand (`lagebuch_suchen`,
 * `lagebuch_lesen`); a round carries at most one line that says how many new
 * entries other chats brought. It is a ring buffer: past its limit the oldest
 * entries drop out. A confidential chat neither writes into it nor can be
 * found through it.
 */

import type { AgentChatKind } from "./AgentChatSession";

/** The kinds of an entry; the tool `lagebuch_merken` names them in German. */
export const AGENT_LOGBOOK_KINDS = [
  "decision",
  "open",
  "fact",
  "question",
  "note",
] as const;

/** What an entry is: a decision, a task or open point, a fact, a question or a note. */
export type AgentLogbookKind = (typeof AGENT_LOGBOOK_KINDS)[number];

/** Who wrote an entry: the agent itself with its tool, or the summary in the background. */
export type AgentLogbookOrigin = "agent" | "background";

/** The entries a Lagebuch holds before the oldest drop out, by default. */
export const AGENT_LOGBOOK_LIMIT_DEFAULT = 200;
/** The lowest and the highest limit an agent can be given. */
export const AGENT_LOGBOOK_LIMIT_RANGE = { minimum: 10, maximum: 2_000 };
/** Minutes without a message until the background summary of a chat runs, by default. */
export const AGENT_LOGBOOK_QUIET_DEFAULT_MINUTES = 2;
/** The shortest and the longest quiet time an agent can be given. */
export const AGENT_LOGBOOK_QUIET_RANGE = { minimum: 1, maximum: 240 };
/** The fill of the Lagebuch, in percent, at which the compaction (Dreaming) is asked for. */
export const AGENT_LOGBOOK_COMPACTION_PERCENT = 80;
/** Characters of the text of one entry. */
export const AGENT_LOGBOOK_TEXT_CHARACTERS = 500;
/** Characters of the short topic that names an entry in the hint line. */
export const AGENT_LOGBOOK_TOPIC_CHARACTERS = 40;
/** What one call of `lagebuch_suchen` and `lagebuch_lesen` returns at most. */
export const AGENT_LOGBOOK_READ_LIMITS = { search: 10, read: 20 } as const;

/** Where an entry comes from: a normal chat of the agent, named as it was when the entry was written. */
export interface AgentLogbookSource {
  readonly kind: AgentChatKind;
  /** The ID of the person (direct chat) or of the conversation (group). */
  readonly id: string;
  readonly name: string;
}

/** One entry of the Lagebuch as the tab lists it. */
export interface AgentLogbookEntryView {
  readonly id: string;
  readonly kind: AgentLogbookKind;
  readonly text: string;
  /** The short name of the entry, as the hint line uses it. */
  readonly topic: string;
  /** ISO time the entry was written. */
  readonly at: string;
  readonly source: AgentLogbookSource;
  /** The people of the chat the entry is about, without the agent. */
  readonly participants: readonly string[];
  readonly origin: AgentLogbookOrigin;
}

/** A model the background summary can run on. */
export interface AgentLogbookModelChoice {
  readonly connectionId: string;
  readonly model: string;
  /** The name as the lists show it. */
  readonly label: string;
}

/** What can be set per agent. */
export interface AgentLogbookSettings {
  /** The entries after which the oldest drop out. */
  readonly limit: number;
  /** Minutes without a message until a quiet chat is summarized. */
  readonly quietMinutes: number;
  /** The model of the background summary; `null` follows the instance, and without one the agent's own model. */
  readonly model: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
}

/** A chat the entries can be filtered by. */
export interface AgentLogbookChatOption {
  readonly kind: AgentChatKind;
  readonly id: string;
  readonly name: string;
}

/** What the tab "Lagebuch" shows for one agent. */
export interface AgentLogbookOverview {
  readonly agentId: string;
  readonly agentName: string;
  /** The entries the viewer may see, the newest first. */
  readonly entries: readonly AgentLogbookEntryView[];
  /** All entries of the Lagebuch, whoever may see them. */
  readonly count: number;
  /** The fill in percent, rounded and at most 100. */
  readonly fillPercent: number;
  readonly settings: AgentLogbookSettings;
  /** The model the instance names for the background summary; `null` without one. */
  readonly instanceModel: AgentLogbookModelChoice | null;
  /** The models the administrator can choose from; empty for everybody else. */
  readonly models: readonly AgentLogbookModelChoice[];
  readonly chats: readonly AgentLogbookChatOption[];
  /** Whether the viewer may save the settings. */
  readonly canChangeSettings: boolean;
}

/** Why a request about the Lagebuch was refused. */
export type AgentLogbookFailure =
  "forbidden" | "notFound" | "invalidInput" | "unavailable";

/** The answer of the endpoint of the Lagebuch. */
export type AgentLogbookResponse =
  | { readonly ok: true; readonly overview: AgentLogbookOverview }
  | { readonly ok: false; readonly error: AgentLogbookFailure };

/** The endpoint that reads and changes the Lagebuch of an agent. */
export const AGENT_LOGBOOK_ENDPOINT = "/chat-page-api/agent-logbook";

/**
 * The tools of the Lagebuch an agent session is given (PAGE-377). Each takes
 * the input of the model as `unknown`, checks it and answers a plain value.
 */
export interface AgentLogbookTools {
  /** `lagebuch_merken(art, text)`. */
  remember(input: unknown): Promise<unknown>;
  /** `lagebuch_suchen(text)`. */
  search(input: unknown): Promise<unknown>;
  /** `lagebuch_lesen(chat, thema)`. */
  read(input: unknown): Promise<unknown>;
}

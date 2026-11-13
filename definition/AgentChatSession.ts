/**
 * Contracts of the chat sessions of agents (PAGE-376).
 *
 * @remarks
 * An agent keeps exactly one session per direct chat with a person and one
 * per group it is a member of. The session rests after a time without a
 * message (its process ends, its identifier and state stay), restarts with a
 * summary when its context is full, and takes new messages from an inbox
 * instead of the whole history.
 */

import { AGENT_CHAT_IDLE_MAXIMUM_MINUTES } from "./AgentSessionLimits";

/**
 * The shortest and the longest idle time an agent can be given; the default
 * of the instance is `AGENT_CHAT_IDLE_DEFAULT_MINUTES` (30 minutes).
 */
export const AGENT_CHAT_SESSION_IDLE_RANGE = {
  minimum: 1,
  maximum: AGENT_CHAT_IDLE_MAXIMUM_MINUTES,
};
/** The fill of the context, in percent, at which a session restarts, by default. */
export const AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT = 80;
/** The lowest and the highest restart threshold an agent can be given. */
export const AGENT_CHAT_SESSION_RESTART_RANGE = { minimum: 10, maximum: 95 };

/** What one call of the tool `chat_lesen` returns at most. */
export const CHAT_READ_LIMITS = { messages: 20, characters: 12_000 } as const;

/** The chat a session belongs to: a person's direct chat or a group. */
export type AgentChatKind = "direct" | "group";

/**
 * Where a chat session of an agent stands.
 *
 * @remarks
 * `working` answers now; `ready` holds a live process that waits for the next
 * message; `resting` has no process and continues through the provider's
 * resume with the next message; `restart_needed` reached the restart
 * threshold and starts anew with its summary before it answers again.
 */
export type AgentChatSessionState =
  "working" | "ready" | "resting" | "restart_needed";

/** The chat of a session as the lists name it. */
export interface AgentChatSessionChat {
  readonly kind: AgentChatKind;
  /** The ID of the person (direct chat) or of the conversation (group). */
  readonly id: string;
  /** The name of the group, or of the person of a direct chat. */
  readonly name: string;
  /** Whether the chat is marked confidential. */
  readonly isConfidential: boolean;
}

/** The short state of one chat session, for the head of a chat and its menus. */
export interface AgentChatSessionBrief {
  readonly sessionId: string;
  readonly agentId: string;
  readonly state: AgentChatSessionState;
  /** How full the context is, in percent; `null` before the first round. */
  readonly contextPercent: number | null;
  /** Messages of the chat that wait for their turn in the session. */
  readonly waitingMessages: number;
}

/** One chat session of an agent as the tab "Sitzungen" lists it. */
export interface AgentChatSessionView extends AgentChatSessionBrief {
  readonly chat: AgentChatSessionChat;
  /** Tokens the session used in total. */
  readonly tokens: number;
  /** ISO time of the last round or message; `null` before the first. */
  readonly lastActivityAt: string | null;
}

/** What can be set per agent. */
export interface AgentChatSessionSettings {
  /** Minutes without a message until the process of a session ends. */
  readonly idleMinutes: number;
  /** The context fill, in percent, at which a session restarts. */
  readonly restartPercent: number;
}

/** What the tab "Sitzungen" shows for one agent. */
export interface AgentChatSessionOverview {
  readonly agentId: string;
  readonly agentName: string;
  readonly sessions: readonly AgentChatSessionView[];
  /** Sessions with a live process: working or ready. */
  readonly openSessions: number;
  /** Sessions without a process. */
  readonly restingSessions: number;
  /** Tokens all sessions of the agent used today. */
  readonly tokensToday: number;
  readonly settings: AgentChatSessionSettings;
  /** Whether the viewer may save the settings. */
  readonly canChangeSettings: boolean;
}

/** What can be done to one session. */
export type AgentChatSessionAction = "stop" | "summarize" | "restart";

/** Why a request about chat sessions was refused. */
export type AgentChatSessionFailure =
  "forbidden" | "notFound" | "invalidInput" | "unavailable";

/** The answer of the endpoint of the chat sessions of agents. */
export type AgentChatSessionResponse =
  | { readonly ok: true; readonly overview: AgentChatSessionOverview }
  | { readonly ok: false; readonly error: AgentChatSessionFailure };

/** The endpoint that reads and changes the chat sessions of agents. */
export const AGENT_CHAT_SESSION_ENDPOINT = "/chat-page-api/agent-sessions";

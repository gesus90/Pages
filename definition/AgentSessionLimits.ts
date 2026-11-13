/**
 * Limits of the concurrent chat sessions of agents (PAGE-304).
 *
 * @remarks
 * Every chat of an agent has its own session; sessions of different chats
 * run side by side. A session rests between the rounds of its chat and ends
 * after the idle time (PAGE-335). Above a limit a message is queued, never refused, and
 * answered once a place is free.
 */

/** Concurrent sessions of one agent before its next message waits. */
export const AGENT_SESSION_DEFAULT_PER_AGENT = 4;
/** Concurrent sessions of all agents together before the next message waits. */
export const AGENT_SESSION_DEFAULT_TOTAL = 16;
/** The highest value either limit takes. */
export const AGENT_SESSION_LIMIT_MAXIMUM = 64;
/**
 * Minutes a chat session of an agent rests after its last round before it
 * ends and releases its process (PAGE-335).
 */
export const AGENT_CHAT_IDLE_DEFAULT_MINUTES = 10;
/** The longest idle time of a resting chat session, one day. */
export const AGENT_CHAT_IDLE_MAXIMUM_MINUTES = 1440;

/** The stored limits with the revision they were read at. */
export interface AgentSessionLimits {
  readonly perAgent: number;
  readonly total: number;
  readonly revision: number;
  /** The time of day of the nightly dream run, `HH:MM` in the time zone of the server (PAGE-305). */
  readonly dreamTime: string;
  /** Minutes a chat session of an agent rests before it ends (PAGE-335). */
  readonly idleMinutes: number;
}

/** What the settings card shows: the limits and how many sessions run and wait now. */
export interface AgentSessionLimitsAdministration {
  readonly limits: AgentSessionLimits;
  readonly running: number;
  readonly waiting: number;
}

/**
 * Why a message waits before its agent answers it.
 *
 * @remarks
 * `chat` waits for the answer the agent is giving in the same chat; `limit`
 * waits because the agent or all agents together reached their limit of
 * concurrent sessions.
 */
export type AgentMessageQueue = "chat" | "limit";

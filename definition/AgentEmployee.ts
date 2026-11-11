/**
 * Contracts of agents that Pages keeps like employees (PAGE-266).
 *
 * @remarks
 * An agent is an account of its own: it has a username, a role, departments
 * and project memberships like a person, but no password, no sign-in and
 * never the administrator right. Beside the account it has a model, an
 * access mode and four documents: `SOUL.md`
 * (who it is), `AGENT.md` (what it does), `MEMORY.md` (its current topics,
 * with a searchable archive behind it) and `DREAM.md` (its lessons,
 * PAGE-305).
 */

import type { AgentMemoryLimits, AgentMemorySource } from "./AgentMemory";

/**
 * The access level of an agent in its chats (PAGE-303).
 *
 * @remarks
 * - `read_only` ("Nur Pages", the default): the Pages tools alone; every
 *   other tool is refused by Pages, not only forbidden by the instruction.
 * - `workspace` ("Arbeitsplatz"): every program, shell, web, browser and the
 *   configured MCP servers of the host, inside the bubblewrap isolation of
 *   the CLI runs; it writes only in the working folder of the chat.
 * - `yolo`: no restriction by Pages on the host and no isolation; the agent
 *   works with the rights of the system account Pages runs under.
 *
 * Plan steps keep their own run options; the level applies to chats only.
 */
export const AGENT_EMPLOYEE_ACCESS_MODES = [
  "read_only",
  "workspace",
  "yolo",
] as const;

/** An access level of {@link AGENT_EMPLOYEE_ACCESS_MODES}. */
export type AgentEmployeeAccess = (typeof AGENT_EMPLOYEE_ACCESS_MODES)[number];

/** Narrows an unknown value to an access level. */
export function isAgentEmployeeAccess(
  value: unknown,
): value is AgentEmployeeAccess {
  return AGENT_EMPLOYEE_ACCESS_MODES.some((mode) => mode === value);
}

/** Whether an access level gives the agent the tools of the host beside the Pages tools. */
export function hasHostTools(access: AgentEmployeeAccess): boolean {
  return access !== "read_only";
}

/** How a configured MCP server is reached. */
export type AgentMcpTransport = "stdio" | "http" | "sse";

/**
 * An MCP server Pages found in the configuration of the agent's CLI on this
 * host; only name, transport and origin, never a command line, header or
 * environment value.
 */
export interface AgentDetectedMcpServer {
  readonly name: string;
  readonly transport: AgentMcpTransport;
  /** The configuration file it came from, with the home folder as `~`. */
  readonly source: string;
}

/** What the tab "Zugriff" shows beside the level. */
export interface AgentAccessEnvironment {
  /** Whether the bubblewrap isolation works on this host; without it "Arbeitsplatz" cannot be chosen. */
  readonly isIsolationAvailable: boolean;
  /** The MCP servers a chat of the agent receives in "Arbeitsplatz" and "YOLO", read anew for every chat. */
  readonly mcpServers: readonly AgentDetectedMcpServer[];
}

/** Fixed length limits of the documents an agent gets in every session. */
export const AGENT_DOCUMENT_LIMITS = {
  /** Characters of `SOUL.md`. */
  soulCharacters: 6_000,
  /** Characters of `AGENT.md`. */
  instructionsCharacters: 12_000,
} as const;

/**
 * Word limits of the archive; `MEMORY.md` and `DREAM.md` have character
 * limits per agent (PAGE-305).
 */
export const AGENT_MEMORY_LIMITS = {
  /** The archive, searched only on demand. */
  archiveWords: 100_000,
  /** Words of one archive entry. */
  entryWords: 2_000,
} as const;

/**
 * Counts the words of a text as the memory limits count them.
 *
 * @param text - Markdown or plain text.
 * @returns The number of whitespace-separated words.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

/** Model and access of an agent. */
export interface AgentEmployeeSettings {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: AgentEmployeeAccess;
}

/** The two documents that shape every session of an agent. */
export interface AgentEmployeeDocuments {
  /** `SOUL.md`: character, tone and limits. */
  readonly soul: string;
  /** `AGENT.md`: job, responsibility and way of working. */
  readonly instructions: string;
}

/** What a dream run did. */
export type AgentLearningStatus = "updated" | "unchanged" | "failed";

/** The result of the last dream run (PAGE-305), formerly the learning run. */
export interface AgentLearningResult {
  readonly status: AgentLearningStatus;
  /** Lessons taken in from the sources of the day. */
  readonly added: number;
  /** Lessons merged with a similar one. */
  readonly merged: number;
  /** Topics moved from `MEMORY.md` into the archive. */
  readonly archived: number;
  /** Lessons that fell out of the full `DREAM.md`. */
  readonly removed: number;
  /** The error code of a failed run. */
  readonly errorCode: string | null;
}

/** The switch of the dream run, its time of day and the runs of an agent. */
export interface AgentLearningState {
  readonly isEnabled: boolean;
  /** The time of day of the dream run, `HH:MM` in the time zone of the server. */
  readonly dreamTime: string;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly lastResult: AgentLearningResult | null;
}

/** Word counts of both memory levels. */
export interface AgentMemoryUsage {
  readonly coreWords: number;
  readonly archiveWords: number;
}

/** What an agent spent in the current calendar month. */
export interface AgentCostState {
  /** Known costs of the month in US dollars. */
  readonly spent: number;
  /** Sessions of the month whose model reported no cost. */
  readonly unknownSessions: number;
  /** The month as `YYYY-MM` (UTC). */
  readonly month: string;
}

/** Fields of the avatar an agent shares with every account. */
export interface AgentEmployeeIdentity {
  /** The user ID of the agent's account. */
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  /** The job title, apart from the role that decides the rights. */
  readonly position: string | null;
  readonly avatarColor: string | null;
  readonly avatarImageUrl: string | null;
  readonly isActive: boolean;
}

/** One row of the agents tab. */
export interface AgentEmployeeListItem extends AgentEmployeeIdentity {
  readonly modelName: string;
  readonly provider: string | null;
  readonly roleId: string | null;
  readonly roleName: string | null;
}

/** Everything the agent panel shows and edits. */
export interface AgentEmployee extends AgentEmployeeListItem {
  readonly departmentIds: readonly string[];
  readonly settings: AgentEmployeeSettings;
  readonly documents: AgentEmployeeDocuments;
  /** `MEMORY.md`: the current topics. */
  readonly memory: string;
  /** `DREAM.md`: the lessons of the dream run (PAGE-305). */
  readonly dream: string;
  /** The character limits of both files. */
  readonly memoryLimits: AgentMemoryLimits;
  readonly memoryUsage: AgentMemoryUsage;
  readonly learning: AgentLearningState;
  readonly cost: AgentCostState;
  readonly revision: number;
  /** When the agent was created, ISO 8601. */
  readonly createdAt: string;
  /** When its configuration, documents or memory last changed, ISO 8601. */
  readonly updatedAt: string;
}

/** Why a version of the memory exists. */
export type AgentMemoryVersionReason =
  "initial" | "learning" | "edit" | "restore" | "update" | "dream" | "reset";

/** A restorable version of `MEMORY.md`, `DREAM.md` and the archive. */
export interface AgentMemoryVersion {
  readonly id: string;
  readonly reason: AgentMemoryVersionReason;
  readonly createdAt: string;
  readonly coreWords: number;
  readonly archiveWords: number;
}

/** One entry of the archive. */
export interface AgentArchiveEntry {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly createdAt: string;
  /** Where the entry comes from; `null` for entries of earlier versions (PAGE-305). */
  readonly source: AgentMemorySource | null;
}

/** What one line of the activity reports. */
export type AgentActivityKind =
  "session" | "learning" | "ticket" | "wiki" | "access";

/** How much a session or learning run cost, as far as the model reported it. */
export interface AgentActivityCost {
  readonly state: "known" | "unknown" | "none";
  /** US dollars, for a known cost. */
  readonly amount: number | null;
  readonly isEstimated: boolean;
}

/** One line of an agent's activity. */
export interface AgentActivityEntry {
  readonly id: string;
  readonly kind: AgentActivityKind;
  readonly at: string;
  /**
   * Kind-specific detail: the session state, the ticket key and title, the
   * wiki page title or the learning status; never a credential.
   */
  readonly detail: string;
  /** A Pages address to open, when there is one. */
  readonly link: string | null;
  readonly cost: AgentActivityCost;
}

/** The archive and the versions an authorized person may read. */
export interface AgentMemoryDetails {
  readonly archive: readonly AgentArchiveEntry[];
  readonly versions: readonly AgentMemoryVersion[];
}

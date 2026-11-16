import {
  AGENT_ACCESS_MODES,
  isAgentAccessMode,
  storedAgentAccessMode,
} from "./AgentAccessMode";

import type { AgentAccessMode } from "./AgentAccessMode";
import type { AgentEmployeeVoice } from "./SpeechSynthesis";
import type { AgentToolGroup } from "./AgentToolGroups";

/**
 * Contracts of agents that Pages keeps like employees.
 * @remarks
 * An agent is an account of its own: it has a username, a role, departments
 * and project memberships like a person, but no password, no sign-in and
 * never the administrator right. Beside the account it has a model, an
 * access mode and four documents: `SOUL.md`
 * (who it is), `AGENT.md` (what it does), `MEMORY.md` (its current topics,
 * with a searchable archive behind it) and `DREAM.md` (its lessons).
 */

import type { AgentMemoryLimits, AgentMemorySource } from "./AgentMemory";

/**
 * The access levels an agent can be given: the two modes of
 * {@link AGENT_ACCESS_MODES}, with the same meaning as for plan nodes and
 * swarms, in chats and in the agent's own jobs alike.
 */
export const AGENT_EMPLOYEE_ACCESS_MODES = AGENT_ACCESS_MODES;

/**
 * The stored access level of an agent.
 * @remarks
 * `workspace` ("Arbeitsplatz") is an earlier level: it stays readable, never
 * runs and never becomes YOLO on its own; the agent needs a choice of
 * "Lesend" or "YOLO" before its next session.
 */
export type AgentEmployeeAccess = AgentAccessMode | "workspace";

/** Narrows an unknown value to a stored access level, the earlier `workspace` included. */
export function isAgentEmployeeAccess(
  value: unknown,
): value is AgentEmployeeAccess {
  return isAgentAccessMode(value) || value === "workspace";
}

/**
 * The mode a stored access level runs in.
 * @returns `null` for the earlier `workspace`, which needs a choice first.
 */
export function employeeAccessMode(
  access: AgentEmployeeAccess,
): AgentAccessMode | null {
  return storedAgentAccessMode(access);
}

/** Whether an access level lets the agent change the host: commands, files and the host's MCP servers. */
export function hasHostTools(access: AgentEmployeeAccess): boolean {
  return access === "yolo";
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
  /** Whether the read-only namespace works on this host; "Lesend" then also mounts the host read-only. */
  readonly isIsolationAvailable: boolean;
  /** Whether native YOLO sessions can start: the service manager confirms their process ownership. */
  readonly isNativeHostAvailable: boolean;
  /** The MCP servers a session of the agent receives in YOLO, read anew for every session. */
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
 * limits per agent.
 */
export const AGENT_MEMORY_LIMITS = {
  /** The archive, searched only on demand. */
  archiveWords: 100_000,
  /** Words of one archive entry. */
  entryWords: 2_000,
} as const;

/**
 * Counts the words of a text as the memory limits count them.
 * @param text - Markdown or plain text.
 * @returns The number of whitespace-separated words.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

/** Model and access of an agent. */
export interface AgentEmployeeSettings {
  /** Optional budget for Claude plan steps, using their computed OpenRouter cost. */
  readonly claudeMonthlyCostLimitUsd?: number | null;
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: AgentEmployeeAccess;
  /**
   * The tool groups an administrator switched off for the agent;
   * empty gives every group its access level allows.
   */
  readonly disabledToolGroups: readonly AgentToolGroup[];
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

/** The result of the last dream run, formerly the learning run. */
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
  /** The voice and speed of the agent; kept when the instance's model changes. */
  readonly voice: AgentEmployeeVoice;
  /** `MEMORY.md`: the current topics. */
  readonly memory: string;
  /** `DREAM.md`: the lessons of the dream run. */
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
  /** Where the entry comes from; `null` for entries of earlier versions. */
  readonly source: AgentMemorySource | null;
}

/** What one line of the activity reports. */
export type AgentActivityKind =
  | "session"
  | "learning"
  | "ticket"
  | "wiki"
  | "access"
  | "image"
  | "video"
  | "audio";

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

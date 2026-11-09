/**
 * Contracts of agents that Pages keeps like employees (PAGE-266).
 *
 * @remarks
 * An agent is an account of its own: it has a username, a role, departments
 * and project memberships like a person, but no password, no sign-in and
 * never the administrator right. Beside the account it has a model, an
 * access mode, an optional monthly cost limit and three documents: `SOUL.md`
 * (who it is), `AGENT.md` (what it does) and `MEMORY.md` (what it learned),
 * with a searchable archive behind the memory.
 */

/** How an agent may work on the host: Pages tools only, or every system tool inside the isolation. */
export const AGENT_EMPLOYEE_ACCESS_MODES = ["read_only", "yolo"] as const;

/** An access mode of {@link AGENT_EMPLOYEE_ACCESS_MODES}. */
export type AgentEmployeeAccess = (typeof AGENT_EMPLOYEE_ACCESS_MODES)[number];

/** Narrows an unknown value to an access mode. */
export function isAgentEmployeeAccess(
  value: unknown,
): value is AgentEmployeeAccess {
  return value === "read_only" || value === "yolo";
}

/**
 * The providers whose conversation runs an agent with full access.
 *
 * @remarks
 * Claude Code reaches the Pages tools through the helper, which a full-access
 * session runs like any other command inside the isolation. Codex and
 * OpenCode answer the chat with their native Pica builds, and Antigravity
 * with its bridge alone; none of them runs a chat session with system tools,
 * so they offer "Nur Lesen" only.
 */
const FULL_ACCESS_PROVIDERS: ReadonlySet<string> = new Set(["claude_code"]);

/**
 * The access modes an agent may get with a provider.
 *
 * @param provider - The provider of the agent's connection.
 * @returns "Nur Lesen", and "YOLO" where the provider runs it.
 */
export function employeeAccessModes(
  provider: string,
): readonly AgentEmployeeAccess[] {
  return FULL_ACCESS_PROVIDERS.has(provider)
    ? ["read_only", "yolo"]
    : ["read_only"];
}

/** Fixed length limits of the documents an agent gets in every session. */
export const AGENT_DOCUMENT_LIMITS = {
  /** Characters of `SOUL.md`. */
  soulCharacters: 6_000,
  /** Characters of `AGENT.md`. */
  instructionsCharacters: 12_000,
} as const;

/** Word limits of the two memory levels. */
export const AGENT_MEMORY_LIMITS = {
  /** `MEMORY.md`, loaded in every session. */
  coreWords: 5_000,
  /** The archive, searched only on demand. */
  archiveWords: 100_000,
  /** Words of one archive entry. */
  entryWords: 2_000,
} as const;

/** Hours between two learning runs. */
export const AGENT_LEARNING_INTERVAL_HOURS = 12;

/** Largest monthly cost limit in US dollars an agent may get. */
export const AGENT_MAXIMUM_COST_LIMIT = 1_000_000;

/** The templates `AGENT.md` can be filled from. */
export const AGENT_INSTRUCTION_TEMPLATES = [
  "coder",
  "designer",
  "manager",
] as const;

/** A template of {@link AGENT_INSTRUCTION_TEMPLATES}. */
export type AgentInstructionTemplate =
  (typeof AGENT_INSTRUCTION_TEMPLATES)[number];

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

/** Model, access and cost limit of an agent. */
export interface AgentEmployeeSettings {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: AgentEmployeeAccess;
  /** US dollars per calendar month; `null` sets no limit. */
  readonly monthlyCostLimit: number | null;
}

/** The two documents that shape every session of an agent. */
export interface AgentEmployeeDocuments {
  /** `SOUL.md`: character, tone and limits. */
  readonly soul: string;
  /** `AGENT.md`: job, responsibility and way of working. */
  readonly instructions: string;
}

/** What a learning run did. */
export type AgentLearningStatus =
  "updated" | "unchanged" | "failed" | "limitReached";

/** The result of the last learning run. */
export interface AgentLearningResult {
  readonly status: AgentLearningStatus;
  /** Facts taken in from the sources. */
  readonly added: number;
  /** Duplicates merged into one fact. */
  readonly merged: number;
  /** Facts moved from `MEMORY.md` into the archive. */
  readonly archived: number;
  /** Outdated facts removed. */
  readonly removed: number;
  /** The error code of a failed run. */
  readonly errorCode: string | null;
}

/** Learning switch, rhythm and the runs of an agent. */
export interface AgentLearningState {
  readonly isEnabled: boolean;
  readonly intervalHours: number;
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
  /** The limit in US dollars, or `null` without one. */
  readonly limit: number | null;
  /** Known costs of the month in US dollars. */
  readonly spent: number;
  /** Sessions of the month whose model reported no cost. */
  readonly unknownSessions: number;
  readonly isReached: boolean;
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
  /** `MEMORY.md`. */
  readonly memory: string;
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
  "initial" | "learning" | "edit" | "restore";

/** A restorable version of `MEMORY.md` and its archive. */
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
}

/** What one line of the activity reports. */
export type AgentActivityKind =
  "session" | "learning" | "ticket" | "wiki" | "limit";

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

/**
 * The one access contract of every agent that runs native tools: agent
 * employees in direct and group chats and in their own jobs, plan nodes,
 * the main agent of a swarm and its helpers.
 * @remarks
 * There are exactly two modes, with the same meaning wherever an agent runs:
 * - `read_only` ("Lesend"): the agent reads readable paths of the host, also
 *   outside its working folder, searches and reads the web and the Pages
 *   tools. Every change of a file, every deletion, every command (including
 *   `sudo`) and every changing MCP or browser call is refused before it runs,
 *   by the read-only profile of the provider and by the classification of
 *   Pages at its tool boundaries. An operation Pages cannot classify as
 *   reading is refused.
 * - `yolo` ("YOLO"): the agent runs as a native process of the Linux account
 *   that executes it, with the real home folder, a PATH built from the
 *   account's login environment and every native tool, shell, web, browser
 *   and configured host MCP server. Pages adds no file, workspace, container
 *   or namespace boundary; the working folder is only where it starts. Pages
 *   operations keep the rights of the agent's own account.
 * The earlier values `workspace` ("Arbeitsplatz") and `workspace_write` are
 * kept readable but never run: an agent stored with one of them needs a
 * choice of one of the two modes first. An explicitly stored
 * `full_environment` is the same as `yolo`.
 */

/** The two modes, in the order the interface offers them. */
export const AGENT_ACCESS_MODES = ["read_only", "yolo"] as const;

/** One of {@link AGENT_ACCESS_MODES}. */
export type AgentAccessMode = (typeof AGENT_ACCESS_MODES)[number];

/** The mode of a new agent or of one whose configuration names none. */
export const DEFAULT_AGENT_ACCESS_MODE: AgentAccessMode = "read_only";

/**
 * The version of the meaning of both modes.
 * @remarks
 * It is part of the identity of every kept session, so a session opened
 * under an earlier meaning, or in the other mode, is never continued.
 * Version 2 runs YOLO natively on the host and lets "Lesend" read the whole
 * host.
 */
export const AGENT_ACCESS_POLICY_VERSION = 2;

/** Earlier stored values that are no mode of their own any more. */
export type LegacyAgentAccess = "workspace" | "workspace_write";

/** Narrows an unknown value to one of the two modes. */
export function isAgentAccessMode(value: unknown): value is AgentAccessMode {
  return value === "read_only" || value === "yolo";
}

/**
 * The mode a stored access value runs in.
 * @param stored - The value as it was stored or imported.
 * @returns The mode, `yolo` for an explicitly stored `full_environment`, and
 * `null` for `workspace`, `workspace_write` and every unknown value, which
 * need a choice before the next start and never become YOLO on their own.
 */
export function storedAgentAccessMode(stored: unknown): AgentAccessMode | null {
  if (stored === "full_environment") return "yolo";
  return isAgentAccessMode(stored) ? stored : null;
}

/** Whether a stored value is an earlier value that needs a choice before the next start. */
export function isLegacyAgentAccess(stored: unknown): boolean {
  return storedAgentAccessMode(stored) === null;
}

/**
 * What one mode lets an agent do, whatever runs it.
 * @remarks
 * Plans, swarms and agent employees take these facts from
 * {@link effectiveAgentAccess} alone; the place an agent runs in never
 * changes them. A provider that cannot offer one of them reports the
 * missing capability by name instead.
 */
export interface AgentEffectiveAccess {
  readonly mode: AgentAccessMode;
  readonly policyVersion: number;
  /** `native_host`: a native process without a sandbox of Pages; `read_only`: the provider's read-only profile, inside the read-only namespace where it works. */
  readonly execution: "native_host" | "read_only";
  /** Host files: read everywhere the account may read, or also create, change and delete. */
  readonly files: "read" | "read_write";
  /** Commands of a shell, including `sudo`; never in "Lesend". */
  readonly shell: boolean;
  /** Web search and fetch; reading in both modes. */
  readonly web: "read" | "full";
  /** The browser: only the controlled reading operations, or every action. */
  readonly browser: "read" | "full";
  /** Whether the MCP servers configured on the host are handed to the session. */
  readonly hostMcpServers: boolean;
  /** The Pages tools, always with the rights of the agent's account. */
  readonly pages: "read" | "full";
  /** Whether native permission prompts are approved, so nothing waits for a person. */
  readonly approvesNativePrompts: boolean;
}

const READ_ONLY_ACCESS: AgentEffectiveAccess = {
  mode: "read_only",
  policyVersion: AGENT_ACCESS_POLICY_VERSION,
  execution: "read_only",
  files: "read",
  shell: false,
  web: "read",
  browser: "read",
  // A host MCP server is not classified by Pages; a hint of the server itself proves nothing.
  hostMcpServers: false,
  pages: "read",
  approvesNativePrompts: false,
};

const YOLO_ACCESS: AgentEffectiveAccess = {
  mode: "yolo",
  policyVersion: AGENT_ACCESS_POLICY_VERSION,
  execution: "native_host",
  files: "read_write",
  shell: true,
  web: "full",
  browser: "full",
  hostMcpServers: true,
  pages: "full",
  approvesNativePrompts: true,
};

/**
 * The effective rights of one mode.
 * @param mode - "Lesend" or "YOLO".
 * @returns The same facts for agent employees, plan nodes and swarms.
 */
export function effectiveAgentAccess(
  mode: AgentAccessMode,
): AgentEffectiveAccess {
  return mode === "yolo" ? YOLO_ACCESS : READ_ONLY_ACCESS;
}

/**
 * The identity of a kept session of a mode; another mode or policy version never continues it.
 * @param prefix - What the session belongs to, such as the runner of an agent employee.
 * @param mode - The mode the session runs in.
 */
export function agentAccessSessionProfile(
  prefix: string,
  mode: AgentAccessMode,
): string {
  return `${prefix}-${mode}-p${AGENT_ACCESS_POLICY_VERSION}`;
}

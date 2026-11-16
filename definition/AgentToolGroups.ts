import { effectiveAgentAccess } from "./AgentAccessMode";
import { employeeAccessMode } from "./AgentEmployee";

import type { AgentEmployeeAccess } from "./AgentEmployee";

/**
 * The tool groups every chat agent receives over the tool bridge of Pages,
 * whatever ACP adapter runs its model.
 * @remarks
 * - `shell`: commands, started in the working folder, long runs in the background.
 * - `files`: read, write, change, list and search files of the host; a
 *   relative path starts at the working folder.
 * - `web`: web search and pages fetched as readable text.
 * - `browser`: the isolated browser of Pages.
 * - `pages`: tickets, wiki, plans and runs, calendar, projects and files with
 *   the rights of the agent's account.
 * - `chat`: answer files, chats, memory, Lagebuch and recipes.
 */
export const AGENT_TOOL_GROUPS = [
  "shell",
  "files",
  "web",
  "browser",
  "pages",
  "chat",
] as const;

/** One group of {@link AGENT_TOOL_GROUPS}. */
export type AgentToolGroup = (typeof AGENT_TOOL_GROUPS)[number];

/**
 * What a group allows: nothing, only its reading tools, or every tool.
 */
export type AgentToolGroupMode = "off" | "read" | "full";

/** The mode of every group for one session. */
export type AgentToolPolicy = Readonly<
  Record<AgentToolGroup, AgentToolGroupMode>
>;

/** Narrows an unknown value to a tool group. */
export function isAgentToolGroup(value: unknown): value is AgentToolGroup {
  return AGENT_TOOL_GROUPS.some((group) => group === value);
}

/**
 * The groups of the host: in YOLO the native tools of the runner reach the
 * same host anyway, so switching one of them off would only hide a
 * capability the agent still has.
 */
export const AGENT_HOST_TOOL_GROUPS: readonly AgentToolGroup[] = [
  "shell",
  "files",
  "web",
  "browser",
];

/**
 * What one mode allows per group, taken from {@link effectiveAgentAccess}.
 * @remarks
 * "Lesend" reads and searches: files, web, browser and Pages only read, the
 * shell is not offered at all, because a command can always change
 * something. The chat tools stay with every agent. YOLO gets every tool.
 * The earlier `workspace` level runs no tool at all until a mode is chosen.
 */
function modePolicy(access: AgentEmployeeAccess): AgentToolPolicy {
  const mode = employeeAccessMode(access);
  if (mode === null)
    return {
      shell: "off",
      files: "off",
      web: "off",
      browser: "off",
      pages: "off",
      chat: "off",
    };
  const effective = effectiveAgentAccess(mode);
  const writes = (level: "read" | "full" | "read_write"): AgentToolGroupMode =>
    level === "read" ? "read" : "full";
  return {
    shell: effective.shell ? "full" : "off",
    files: writes(effective.files),
    web: writes(effective.web),
    browser: writes(effective.browser),
    pages: writes(effective.pages),
    chat: "full",
  };
}

/**
 * Whether an administrator's switch of a group applies in a mode.
 * @returns `false` for a host group in YOLO, whose native tools stay; the
 * interface shows such a switch as without effect.
 */
export function isToolGroupSwitchEffective(
  access: AgentEmployeeAccess,
  group: AgentToolGroup,
): boolean {
  return access !== "yolo" || !AGENT_HOST_TOOL_GROUPS.includes(group);
}

/**
 * The mode of every group for an agent.
 * @param access - The stored access level of the agent.
 * @param disabled - The groups an administrator switched off for this agent.
 * @returns The mode's level per group, `off` for every disabled group whose
 * switch applies in this mode, see {@link isToolGroupSwitchEffective}.
 */
export function agentToolPolicy(
  access: AgentEmployeeAccess,
  disabled: readonly AgentToolGroup[] = [],
): AgentToolPolicy {
  const modes = modePolicy(access);
  const level = (group: AgentToolGroup): AgentToolGroupMode =>
    disabled.includes(group) && isToolGroupSwitchEffective(access, group)
      ? "off"
      : modes[group];
  return {
    shell: level("shell"),
    files: level("files"),
    web: level("web"),
    browser: level("browser"),
    pages: level("pages"),
    chat: level("chat"),
  };
}

/**
 * Reads a list of disabled groups from an untrusted source.
 * @param input - The list as sent or stored; absent means none.
 * @returns The distinct groups in their fixed order, or `null` for anything
 * that is not a list of known groups.
 */
export function readAgentToolGroups(input: unknown): AgentToolGroup[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > AGENT_TOOL_GROUPS.length * 2)
    return null;
  if (!input.every(isAgentToolGroup)) return null;
  return AGENT_TOOL_GROUPS.filter((group) => input.includes(group));
}

/**
 * Whether a change of the disabled groups switches any group on again.
 * @remarks
 * Switching a group off only narrows the agent; switching one on widens it
 * and therefore needs the same right as raising the access level.
 */
export function enablesAgentToolGroup(
  from: readonly AgentToolGroup[],
  to: readonly AgentToolGroup[],
): boolean {
  return from.some((group) => !to.includes(group));
}

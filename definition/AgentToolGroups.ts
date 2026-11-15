import type { AgentEmployeeAccess } from "./AgentEmployee";

/**
 * The tool groups every chat agent receives over the tool bridge of Pages
 * (PAGE-390), whatever ACP adapter runs its model.
 *
 * @remarks
 * - `shell`: commands in the working folder, long runs in the background.
 * - `files`: read, write, change, list and search files of the working folder.
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
 * What each access level allows per group before an administrator switches
 * groups off.
 *
 * @remarks
 * "Nur Lesen" reads and searches: files, web, browser and Pages only read,
 * the shell is not offered at all, because a command can always change
 * something. The chat tools stay, as the ticket allows them to every agent.
 * "Arbeitsplatz" and YOLO get every tool.
 */
const ACCESS_MODES: Readonly<Record<AgentEmployeeAccess, AgentToolPolicy>> = {
  read_only: {
    shell: "off",
    files: "read",
    web: "read",
    browser: "read",
    pages: "read",
    chat: "full",
  },
  workspace: {
    shell: "full",
    files: "full",
    web: "full",
    browser: "full",
    pages: "full",
    chat: "full",
  },
  yolo: {
    shell: "full",
    files: "full",
    web: "full",
    browser: "full",
    pages: "full",
    chat: "full",
  },
};

/**
 * The mode of every group for an agent.
 *
 * @param access - The stored access level of the agent.
 * @param disabled - The groups an administrator switched off for this agent.
 * @returns The access level's mode per group, `off` for every disabled group.
 */
export function agentToolPolicy(
  access: AgentEmployeeAccess,
  disabled: readonly AgentToolGroup[] = [],
): AgentToolPolicy {
  const modes = ACCESS_MODES[access];
  return {
    shell: disabled.includes("shell") ? "off" : modes.shell,
    files: disabled.includes("files") ? "off" : modes.files,
    web: disabled.includes("web") ? "off" : modes.web,
    browser: disabled.includes("browser") ? "off" : modes.browser,
    pages: disabled.includes("pages") ? "off" : modes.pages,
    chat: disabled.includes("chat") ? "off" : modes.chat,
  };
}

/**
 * Reads a list of disabled groups from an untrusted source.
 *
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
 *
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

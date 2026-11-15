import { AUTOMATION_WRITE_TOOLS } from "@/definition/AgentTools/Automations";
import { PLAN_WRITE_TOOLS } from "@/definition/AgentTools/Plans";
import { PLAN_RESOURCE_WRITE_TOOLS } from "@/definition/AgentTools/PlanResources";
import { RECIPE_TOOL } from "@/backend/service/employee/AgentRecipeRules";

import {
  PICA_CHAT_READ_TOOL,
  PICA_CHAT_SEND_TOOL,
  PICA_CHATS_LIST_TOOL,
} from "../PicaChatToolSchemas";
import { PICA_FILE_TOOL, PICA_WRITE_SCHEMAS } from "../PicaToolSchemas";

import { AGENT_ASK_TOOL, AGENT_SAY_TOOL } from "./AgentChatInteractionTools";
import { AGENT_FILE_TOOLS } from "./AgentFileTools";
import { AGENT_SHELL_TOOLS } from "./AgentShellTools";
import { AGENT_WEB_TOOLS } from "./AgentWebTools";

import type { AgentToolGroup, AgentToolPolicy } from "@/definition/AgentToolGroups";
import type { AgentToolkitTool } from "./AgentToolkitContracts";

/** Every tool the toolkit adds to the bridge (PAGE-390). */
export const AGENT_TOOLKIT_TOOLS: readonly AgentToolkitTool[] = [
  ...AGENT_SHELL_TOOLS,
  ...AGENT_FILE_TOOLS,
  ...AGENT_WEB_TOOLS,
];

/** The tools of the chat group: answer files, chats, memory, Lagebuch, recipes, interim messages and questions. */
const CHAT_TOOLS: ReadonlySet<string> = new Set([
  PICA_FILE_TOOL,
  PICA_CHATS_LIST_TOOL,
  PICA_CHAT_READ_TOOL,
  PICA_CHAT_SEND_TOOL,
  "memory_search",
  "read_conversation_context",
  "chat_lesen",
  "lagebuch_merken",
  "lagebuch_suchen",
  "lagebuch_lesen",
  RECIPE_TOOL,
  AGENT_SAY_TOOL,
  AGENT_ASK_TOOL,
]);

/** Browser tools that only look: everything else clicks, types or changes a page. */
const BROWSER_READ_TOOLS: ReadonlySet<string> = new Set([
  "browser_open",
  "browser_observe",
  "browser_navigate",
  "browser_scroll",
  "browser_hover",
  "browser_tabs",
  "browser_viewport",
  "browser_wait",
  "browser_profiles",
  "browser_downloads",
  "browser_close",
]);

/** Pages tools that change something; a Pages group in `read` mode never offers them. */
const PAGES_WRITE_TOOLS: ReadonlySet<string> = new Set([
  ...Object.keys(PICA_WRITE_SCHEMAS),
  ...PLAN_WRITE_TOOLS.map(({ tool }) => tool.name),
  ...PLAN_RESOURCE_WRITE_TOOLS.map(({ tool }) => tool.name),
  ...AUTOMATION_WRITE_TOOLS.map(({ tool }) => tool.name),
  "calendar_event_create",
  "calendar_event_update",
  "calendar_event_respond",
  "calendar_event_delete",
  "tickets_attach_file",
  "wiki_page_attach_file",
  "agents_delete",
  "agents_restore",
]);

const TOOLKIT_BY_ID: ReadonlyMap<string, AgentToolkitTool> = new Map(
  AGENT_TOOLKIT_TOOLS.map((tool) => [tool.id, tool]),
);

/** Where a tool of the bridge belongs and whether it changes something. */
export interface AgentBridgeToolClass {
  readonly group: AgentToolGroup;
  readonly isWrite: boolean;
}

/**
 * Sorts a tool of the bridge into its group (PAGE-390).
 *
 * @param id - The name of the tool.
 * @returns Its group and whether it writes; a tool Pages does not know
 * otherwise is a Pages tool, so the Pages group and its mode decide.
 */
export function classifyBridgeTool(id: string): AgentBridgeToolClass {
  const own = TOOLKIT_BY_ID.get(id);
  if (own) return { group: own.group, isWrite: own.isWrite };
  if (CHAT_TOOLS.has(id)) return { group: "chat", isWrite: false };
  if (id.startsWith("browser_"))
    return { group: "browser", isWrite: !BROWSER_READ_TOOLS.has(id) };
  return { group: "pages", isWrite: PAGES_WRITE_TOOLS.has(id) };
}

/**
 * Whether the policy of a session offers a tool of the bridge.
 *
 * @remarks
 * A group that is `off` offers nothing, one in `read` mode only its tools
 * that do not write. Pages checks writes again on every call, so a tool this
 * classification misses still cannot change anything in `read` mode.
 */
export function isBridgeToolAllowed(
  policy: AgentToolPolicy,
  id: string,
): boolean {
  const { group, isWrite } = classifyBridgeTool(id);
  const mode = policy[group];
  if (mode === "off") return false;
  return mode === "full" || !isWrite;
}

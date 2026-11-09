import { PAGES_MCP_SERVER } from "./AcpLaunch";
import { approvePermission, refusePermission } from "./AcpPermissions";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type {
  AcpConfigStep,
  AcpModelRequest,
  AcpPermissionDecision,
  AcpSessionProfile,
  AcpSessionPurpose,
} from "./AcpDriver";

/** The permission mode of the Claude ACP adapter that carries a Pages mode. */
export type ClaudeAcpSessionMode = "default" | "bypassPermissions";

/**
 * How one Pages mode runs in the Claude ACP adapter.
 *
 * @remarks
 * `options` are the Claude options of the session, passed with `session/new`.
 * In every profile no settings file of the user or the workspace applies and
 * only the MCP server Pages names is reachable, the Pages MCP server of a node
 * or Pica's bridge: the account's own connectors and user MCP servers stay
 * out. "Nur Lesen" gives the model nothing but the reading tools, so no file
 * change and no command exists for it; the adapter's session mode only decides
 * what happens to the rest.
 */
export interface ClaudeAcpProfile extends AcpSessionProfile {
  readonly sessionMode: ClaudeAcpSessionMode;
  readonly options: Readonly<Record<string, unknown>>;
}

/** The only built-in tools of a "Nur Lesen" session. */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];

// Removed as well, so a runner that ignores the allowlist still has no way to change anything.
const READ_ONLY_DISALLOWED_TOOLS = [
  "Bash",
  "PowerShell",
  "Edit",
  "Write",
  "NotebookEdit",
];

/**
 * Every built-in tool of Claude Code except the two Pica's helper needs:
 * `Bash` runs only the exact helper call of the turn and `Read` opens only the
 * image files the helper wrote, both decided by Pages per request. Naming the
 * rest keeps them out should a release add one to the allowed set. Without
 * `ToolSearch` Claude Code loads its tools directly instead of deferring them.
 */
const CHAT_DISALLOWED_TOOLS = [
  "Agent",
  "Task",
  "PowerShell",
  "Monitor",
  "Edit",
  "Write",
  "NotebookEdit",
  "Glob",
  "Grep",
  "LSP",
  "WebSearch",
  "WebFetch",
  "ToolSearch",
  "Skill",
  "CronCreate",
  "RemoteTrigger",
  "EnterWorktree",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
];

/** The built-in tools Pages approves in "Nur Lesen"; reading files needs no approval inside the workspace. */
const READ_ONLY_APPROVED_TOOLS: ReadonlySet<string> = new Set([
  "WebSearch",
  "WebFetch",
]);

/** The runaway protection the earlier Claude runner had. */
const MAXIMUM_TURNS = 200;

// The model option holds a picker choice such as `sonnet`; the model itself is reported by the first usage update.
const REPORTED_OPTIONS = {
  sessionMode: "mode",
  modelOption: "model",
  reasoningEffort: "effort",
} as const;

// Options that keep the user's and the workspace's Claude configuration out of the session.
const MANAGED_OPTIONS = {
  settingSources: [],
  strictMcpConfig: true,
  persistSession: true,
  maxTurns: MAXIMUM_TURNS,
  extraArgs: { "disable-slash-commands": null },
} as const;

function readRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

/** What the adapter says about the tool of a permission request. */
interface RequestedTool {
  readonly name: string | null;
  readonly server: string | null;
}

function readText(input: unknown): string | null {
  return typeof input === "string" ? input : null;
}

/**
 * Reads the tool of a request.
 *
 * @remarks
 * The adapter names a built-in tool in `toolCall.name` and an MCP tool, with
 * its server, in `_meta.claudeCode`; either one may carry the name.
 */
function requestedTool(request: RequestPermissionRequest): RequestedTool {
  const call = readRecord(request.toolCall);
  const claude = readRecord(readRecord(call?._meta)?.claudeCode);
  return {
    name: readText(claude?.toolName) ?? readText(call?.name),
    server: readText(readRecord(claude?.mcpServer)?.name),
  };
}

function isPagesMcpCall(tool: RequestedTool): boolean {
  return (
    tool.name?.startsWith(`mcp__${PAGES_MCP_SERVER}__`) === true &&
    (tool.server === null || tool.server === PAGES_MCP_SERVER)
  );
}

/**
 * Answers a permission request of the adapter; nobody is asked during a run.
 *
 * @param mode - The mode of the agent.
 * @param request - The request of the adapter.
 * @returns The selected option and whether it refuses.
 *
 * @remarks
 * YOLO approves every request once, so nothing waits for a person and no
 * approval is stored for later runs. "Nur Lesen" approves only calls of the
 * Pages MCP tools, whose credential allows nothing but reading, and web
 * search and fetch. Everything else is refused: reads outside the workspace,
 * and every tool that could change a file or run a command, although no such
 * tool is offered in the first place.
 */
export function decideClaudePermission(
  mode: AcpPermissionMode,
  request: RequestPermissionRequest,
): AcpPermissionDecision {
  if (mode === "yolo") return approvePermission(request);
  const tool = requestedTool(request);
  if (
    isPagesMcpCall(tool) ||
    (tool.name !== null && READ_ONLY_APPROVED_TOOLS.has(tool.name))
  )
    return approvePermission(request);
  return refusePermission(request);
}

// The context size of a model may be named with a suffix such as `[1m]`; it does not name another model.
function withoutContextHint(model: string): string {
  return model.replace(/\[\d+m\]$/iu, "").toLowerCase();
}

/**
 * Whether the model the adapter reported is the one the agent stores.
 *
 * @param stored - The model of the agent.
 * @param reported - The model the first usage update named.
 * @returns `true` for the same model with or without a context size suffix,
 * and for a stored family alias such as `sonnet`, which the CLI resolves to
 * its current model on its own.
 */
export function claudeModelMatches(stored: string, reported: string): boolean {
  if (!stored.toLowerCase().startsWith("claude-")) return true;
  return withoutContextHint(stored) === withoutContextHint(reported);
}

// The mode first, then the model; the effort comes last because a model change resets it.
function claudeSteps(
  sessionMode: ClaudeAcpSessionMode,
  request: AcpModelRequest,
): readonly AcpConfigStep[] {
  const steps: AcpConfigStep[] = [
    {
      id: "mode",
      value: sessionMode,
      refusal: "plan_permission_mode_unenforceable",
    },
    {
      id: "model",
      value: request.model,
      refusal: "plan_model_unavailable",
      isResolvedByAdapter: true,
    },
  ];
  if (request.reasoningEffort !== null)
    steps.push({
      id: "effort",
      value: request.reasoningEffort,
      refusal: "plan_reasoning_unsupported",
    });
  return steps;
}

const READ_ONLY_PROFILE: ClaudeAcpProfile = {
  mode: "read_only",
  sessionMode: "default",
  options: {
    ...MANAGED_OPTIONS,
    tools: READ_ONLY_TOOLS,
    disallowedTools: READ_ONLY_DISALLOWED_TOOLS,
  },
  unattended:
    "ACP session mode default with the tools Read, Glob, Grep, WebSearch and WebFetch only; Pages refuses every request except calls of Pages MCP tools and web search, and the MCP server limits itself to reading",
  permissions: {
    permissionMode: "read_only",
    sessionMode: "default, every request answered by Pages",
    tools: READ_ONLY_TOOLS.join(", "),
    files: "read",
    shell: "off",
    web: "search, fetch",
    pagesMcp: "read",
    settings: "none of the user or the workspace",
    mcpServers: "pages only",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: claudeModelMatches,
  hasMcpStatusCommand: true,
  isContinuable: true,
  keepsSession: true,
  steps: (request) => claudeSteps("default", request),
  decide: (request) => decideClaudePermission("read_only", request),
};

const YOLO_PROFILE: ClaudeAcpProfile = {
  mode: "yolo",
  sessionMode: "bypassPermissions",
  options: { ...MANAGED_OPTIONS },
  unattended:
    "ACP session mode bypassPermissions inside the bubblewrap isolation; Pages approves any remaining request",
  permissions: {
    permissionMode: "yolo",
    sessionMode: "bypassPermissions",
    tools: "every native tool of Claude Code",
    files: "read, create, change, delete in the workspace",
    shell: "on",
    web: "search, fetch",
    pagesMcp: "every tool of the executor",
    settings: "none of the user or the workspace",
    mcpServers: "pages only",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: claudeModelMatches,
  hasMcpStatusCommand: true,
  isContinuable: true,
  keepsSession: true,
  steps: (request) => claudeSteps("bypassPermissions", request),
  decide: (request) => decideClaudePermission("yolo", request),
};

/**
 * Pica's conversation (PAGE-90): no settings file and only the Pages helper,
 * whose calls Pages checks one by one. The session is kept on
 * disk, in the connection's credential folder, so the next job of the
 * conversation continues it with `session/resume`. A plan node keeps its
 * session too, but in a private home of its own run (`ClaudePlanSessionHome`),
 * never in this folder.
 */
const CHAT_PROFILE: ClaudeAcpProfile = {
  mode: "read_only",
  sessionMode: "default",
  options: {
    ...MANAGED_OPTIONS,
    persistSession: true,
    tools: ["Bash", "Read"],
    disallowedTools: CHAT_DISALLOWED_TOOLS,
  },
  unattended:
    "ACP session mode default for Pica; Pages approves only the exact helper call of the turn and the image files it wrote, and refuses every other request",
  permissions: {
    permissionMode: "read_only",
    sessionMode: "default, every request answered by Pages",
    tools: "Bash for the Pages helper only, Read for its image files only",
    files: "none",
    shell: "Pages helper only",
    web: "off",
    pagesTools: "Pages helper, one exact call per request",
    settings: "none of the user or the workspace",
    mcpServers: "none",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: claudeModelMatches,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => claudeSteps("default", request),
  decide: refusePermission,
};

/**
 * The conversation of an agent employee with full access (PAGE-266): every
 * native tool of Claude Code inside the bubblewrap isolation, which a YOLO
 * session never runs without, and the Pages helper for its Pages tools. The
 * session is kept like Pica's, so the next job continues it.
 */
const CHAT_FULL_ACCESS_PROFILE: ClaudeAcpProfile = {
  ...YOLO_PROFILE,
  unattended:
    "ACP session mode bypassPermissions for an agent employee with full access, inside the bubblewrap isolation; Pages approves any remaining request",
  permissions: {
    ...YOLO_PROFILE.permissions,
    pagesTools: "Pages helper with the rights of the agent's account",
    mcpServers: "none",
  },
};

/**
 * The adapter configuration of one Pages mode.
 *
 * @param mode - "Nur Lesen" or "YOLO", as the agent stores it.
 * @param purpose - A Pica conversation always takes the chat profile; the
 * caller decides beforehand which stored mode it accepts for it. Only an
 * agent employee with full access reaches the chat purpose in YOLO.
 * @returns Session mode, Claude options and the recorded permissions.
 */
export function claudeAcpProfile(
  mode: AcpPermissionMode,
  purpose: AcpSessionPurpose = "plan",
): ClaudeAcpProfile {
  if (purpose === "chat")
    return mode === "yolo" ? CHAT_FULL_ACCESS_PROFILE : CHAT_PROFILE;
  return mode === "yolo" ? YOLO_PROFILE : READ_ONLY_PROFILE;
}

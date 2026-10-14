import { PAGES_MCP_SERVER } from "./AcpLaunch";
import { approvePermission, refusePermission } from "./AcpPermissions";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type {
  AcpConfigStep,
  AcpModelRequest,
  AcpPermissionDecision,
  AcpSessionProfile,
} from "./AcpDriver";

/** The permission mode of the Claude ACP adapter that carries a Pages mode. */
export type ClaudeAcpSessionMode = "default" | "bypassPermissions";

/**
 * How one Pages mode runs in the Claude ACP adapter.
 *
 * @remarks
 * `options` are the Claude options of the session, passed with `session/new`.
 * In both modes no settings file of the user or the workspace applies and only
 * the Pages MCP server of the node is reachable: the account's own connectors
 * and user MCP servers stay out. "Nur Lesen" gives the model nothing but the
 * reading tools, so no file change and no command exists for it; the adapter's
 * session mode only decides what happens to the rest.
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
  persistSession: false,
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
  steps: (request) => claudeSteps("bypassPermissions", request),
  decide: (request) => decideClaudePermission("yolo", request),
};

/**
 * The adapter configuration of one Pages mode.
 *
 * @param mode - "Nur Lesen" or "YOLO", as the agent stores it.
 * @returns Session mode, Claude options and the recorded permissions.
 */
export function claudeAcpProfile(mode: AcpPermissionMode): ClaudeAcpProfile {
  return mode === "yolo" ? YOLO_PROFILE : READ_ONLY_PROFILE;
}

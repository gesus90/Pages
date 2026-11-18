import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { PAGES_MCP_SERVER, pagesMcpServers } from "./AcpLaunch";
import { approvePermission, refusePermission } from "./AcpPermissions";
import { requireManagedAntigravityConfiguration } from "./AntigravityConfiguration";
import {
  ANTIGRAVITY_EFFORT_OPTION,
  ANTIGRAVITY_MINIMUM_VERSION,
  antigravityAcpArguments,
  isSupportedAntigravityAcp,
} from "./AntigravityAcpLaunch";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type {
  AcpConfigStep,
  AcpDriver,
  AcpModelRequest,
  AcpPermissionDecision,
  AcpSessionProfile,
} from "./AcpDriver";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";

/** Only reading and web tools exist in the read-only plan profile. */
export const ANTIGRAVITY_READ_TOOLS = [
  "view_file",
  "list_directory",
  "search_directory",
  "find_file",
  "search_web",
  "read_url_content",
] as const;

/** How `agy acp` titles a permission request for a tool of the Pages MCP server. */
const PAGES_TOOL_TITLE_PREFIX = `Run mcp_${PAGES_MCP_SERVER}_`;

/** Tool kinds of native tools Pica's session has none of: files, commands, the web and modes. */
const CHAT_REFUSED_KINDS: ReadonlySet<string> = new Set([
  "edit",
  "delete",
  "move",
  "execute",
  "fetch",
  "switch_mode",
]);

const REPORTED_OPTIONS = {
  sessionMode: "mode",
  model: "model",
  reasoningEffort: ANTIGRAVITY_EFFORT_OPTION,
} as const;

// Model and thinking level are selected explicitly, so a remapped value is refused.
function modelSteps(request: AcpModelRequest): AcpConfigStep[] {
  return [
    {
      id: "model",
      value: request.model,
      refusal: "plan_model_unavailable",
      isExplicit: true,
    },
    ...(request.reasoningEffort === null
      ? []
      : [
          {
            id: ANTIGRAVITY_EFFORT_OPTION,
            value: request.reasoningEffort,
            refusal: "plan_reasoning_unsupported" as const,
            isExplicit: true,
          },
        ]),
  ];
}

/**
 * Answers a permission request of Pica's session.
 * @remarks
 * The session has no native tool and no MCP server but Pica's turn-bound
 * bridge, so a request can only stand for a call of a Pica tool, which Pages
 * authorizes again for the person, the conversation and the running turn.
 * The adapter takes the tool's name from the model's own call, so the name is
 * no proof; a request whose kind belongs to a native tool, such as a file
 * change, a command, a web fetch or a mode switch, is refused whatever it
 * names.
 */
function decideChatPermission(
  request: RequestPermissionRequest,
): AcpPermissionDecision {
  const kind = request.toolCall.kind ?? null;
  return kind !== null && CHAT_REFUSED_KINDS.has(kind)
    ? refusePermission(request)
    : approvePermission(request);
}

/**
 * Pica's Antigravity profile: no native tool, only the tools of the Pica
 * bridge, reached as the session's one MCP server.
 */
const CHAT_PROFILE: AcpSessionProfile = {
  mode: "read_only",
  unattended:
    "Official Antigravity ACP; no native tools, only Pica's turn-bound Pages tools, automatic permission decisions",
  permissions: {
    permissionMode: "read_only",
    sessionMode: "default",
    tools: "Pica catalog only, through the turn-bound Pica bridge",
    files: "none",
    shell: "off",
    web: "off",
    mcpServers: "Pica bridge only",
    settings: "Pages isolated context",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => [
    ...modelSteps(request),
    {
      id: "mode",
      value: "default",
      refusal: "plan_permission_mode_unenforceable",
    },
  ],
  decide: decideChatPermission,
};

/**
 * Answers a permission request of a read-only plan node.
 * @remarks
 * In `default` mode `agy acp` asks before every call of an MCP tool, including
 * the step's own Pages tools, so refusing everything would leave the node
 * without them. Only a call of a Pages tool is approved. The node's native
 * tools are limited to the reading allowlist, so no other tool can exist in
 * the session, and anything else is refused.
 */
function decideReadOnlyPermission(
  request: RequestPermissionRequest,
): AcpPermissionDecision {
  const { kind, title } = request.toolCall;
  const isPagesTool =
    (kind ?? "other") === "other" &&
    (title ?? "").startsWith(PAGES_TOOL_TITLE_PREFIX);
  return isPagesTool ? approvePermission(request) : refusePermission(request);
}

// `agy acp` offers the modes default, accept-edits and plan, and refuses `yolo`
// as unknown. A YOLO session therefore runs in `default`, and Pages answers
// every permission request itself with `approvePermission`.
function profile(mode: AcpPermissionMode): AcpSessionProfile {
  return {
    mode,
    unattended:
      "Official Antigravity ACP; exact selectors and automatic permission decisions",
    permissions: {
      sessionMode: "default",
      files: mode === "yolo" ? "workspace write" : "read only",
      shell: mode === "yolo" ? "on" : "off",
      web: "on",
      mcpServers: "Pages supplied only",
      settings: "Pages isolated context",
    },
    reportedOptions: REPORTED_OPTIONS,
    matchesReportedModel: null,
    hasMcpStatusCommand: false,
    isContinuable: true,
    steps: (request) => [
      ...modelSteps(request),
      {
        id: "mode",
        value: "default",
        refusal: "plan_permission_mode_unenforceable",
      },
    ],
    decide: mode === "yolo" ? approvePermission : decideReadOnlyPermission,
  };
}

const YOLO_PROFILE = profile("yolo");

/**
 * The conversation of an agent employee with full access: the YOLO profile of
 * a plan node with every native tool inside the bubblewrap isolation, and the
 * Pages tools of the agent's account over Pica's turn-bound bridge.
 */
const CHAT_FULL_ACCESS_PROFILE: AcpSessionProfile = {
  ...YOLO_PROFILE,
  unattended:
    "Official Antigravity ACP for an agent employee with full access, inside the bubblewrap isolation; exact selectors and automatic permission decisions",
  permissions: {
    ...YOLO_PROFILE.permissions,
    pagesTools: "Pica bridge with the rights of the agent's account",
    mcpServers: "Pica bridge only",
  },
};

/**
 * The group observer: no native tool and no MCP server; Pages
 * refuses every request, so it answers with text alone.
 */
const OBSERVER_PROFILE: AcpSessionProfile = {
  ...CHAT_PROFILE,
  unattended:
    "Official Antigravity ACP for the group observer; no native tool, no MCP server, every request refused",
  permissions: {
    ...CHAT_PROFILE.permissions,
    tools: "none",
    mcpServers: "none",
  },
  decide: refusePermission,
};

/** The official `agy acp` entry point, shared with the existing plan session lifecycle. */
export const ANTIGRAVITY_ACP_DRIVER: AcpDriver = {
  provider: "antigravity",
  binary: "agy",
  launchArguments: antigravityAcpArguments,
  supportedVersions: `${ANTIGRAVITY_MINIMUM_VERSION} or later`,
  // `agy acp` leaves `mcpCapabilities` out of its `initialize` answer, yet it
  // connects to an HTTP MCP server named in `session/new` and calls its tools.
  mcpCapabilities: { http: true },
  errors: {
    modeRequired: "plan_permission_mode_unenforceable",
    adapterMissing: "cli_not_found",
    adapterUnsupported: "antigravity_acp_unsupported",
    sessionFailed: "antigravity_acp_session_failed",
  },
  steeringMeta: null,
  isSupportedAdapter: isSupportedAntigravityAcp,
  profile: (mode, purpose) => {
    if (purpose === "observer") return OBSERVER_PROFILE;
    if (purpose !== "chat") return profile(mode);
    return mode === "yolo" ? CHAT_FULL_ACCESS_PROFILE : CHAT_PROFILE;
  },
  plan: (specification) => {
    const environment = {
      [RUN_INSTANCE_VARIABLE]: specification.instanceId,
      BROWSER: "/bin/true",
    };
    if (specification.purpose === "observer")
      return {
        environment,
        mcpServers: [],
        sessionMeta: { antigravity: { enabledTools: [] } },
      };
    // Pica's bridge comes with the chat session itself; only full access enables the native tools.
    if (specification.purpose === "chat")
      return {
        environment,
        mcpServers: [],
        sessionMeta: {
          antigravity: {
            ...(specification.profile.mode === "yolo"
              ? {}
              : { enabledTools: [] }),
            eagerMcpServers: [PAGES_MCP_SERVER],
          },
        },
      };
    return {
      environment,
      mcpServers: pagesMcpServers(specification.mcp),
      sessionMeta: {
        antigravity: {
          ...(specification.profile.mode === "read_only"
            ? { enabledTools: ANTIGRAVITY_READ_TOOLS }
            : {}),
          eagerMcpServers: [PAGES_MCP_SERVER],
        },
      },
    };
  },
  requireManagedConfiguration: requireManagedAntigravityConfiguration,
};

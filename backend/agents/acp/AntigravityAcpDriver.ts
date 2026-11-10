import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { PAGES_MCP_SERVER, pagesMcpServers } from "./AcpLaunch";
import { approvePermission, refusePermission } from "./AcpPermissions";
import { requireManagedAntigravityConfiguration } from "./AntigravityConfiguration";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type {
  AcpConfigStep,
  AcpDriver,
  AcpModelRequest,
  AcpPermissionDecision,
  AcpSessionProfile,
} from "./AcpDriver";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";

/** Registry release reviewed together with its bundled localharness runtime. */
export const ANTIGRAVITY_ACP_VERSION = "1.4.4";

/** Only reading and web tools exist in the read-only plan profile. */
export const ANTIGRAVITY_READ_TOOLS = [
  "view_file",
  "list_directory",
  "search_directory",
  "find_file",
  "search_web",
  "read_url_content",
] as const;

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
  reasoningEffort: "thinking_level",
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
            id: "thinking_level",
            value: request.reasoningEffort,
            refusal: "plan_reasoning_unsupported" as const,
            isExplicit: true,
          },
        ]),
  ];
}

/**
 * Answers a permission request of Pica's session.
 *
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

function profile(mode: AcpPermissionMode): AcpSessionProfile {
  return {
    mode,
    unattended:
      "Official Antigravity ACP; exact selectors and automatic permission decisions",
    permissions: {
      sessionMode: mode === "yolo" ? "yolo" : "default",
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
        value: mode === "yolo" ? "yolo" : "default",
        refusal: "plan_permission_mode_unenforceable",
      },
    ],
    decide: mode === "yolo" ? approvePermission : refusePermission,
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

/** The official adapter, shared with the existing plan session lifecycle. */
export const ANTIGRAVITY_ACP_DRIVER: AcpDriver = {
  provider: "antigravity",
  binary: "agy_acp_server.par",
  arguments: ["--uid="],
  supportedVersions: ANTIGRAVITY_ACP_VERSION,
  errors: {
    modeRequired: "plan_permission_mode_unenforceable",
    adapterMissing: "cli_not_found",
    adapterUnsupported: "antigravity_acp_unsupported",
    sessionFailed: "antigravity_acp_session_failed",
  },
  steeringMeta: null,
  isSupportedAdapter: (agent): agent is NonNullable<typeof agent> =>
    agent?.name === "antigravity-acp" &&
    agent.version === ANTIGRAVITY_ACP_VERSION,
  profile: (mode, purpose) => {
    if (purpose !== "chat") return profile(mode);
    return mode === "yolo" ? CHAT_FULL_ACCESS_PROFILE : CHAT_PROFILE;
  },
  plan: (specification) => {
    const environment = {
      [RUN_INSTANCE_VARIABLE]: specification.instanceId,
      BROWSER: "/bin/true",
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

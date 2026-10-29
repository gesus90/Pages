import { AgentError } from "@/backend/error/AgentErrors";
import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";

import { pagesMcpServers } from "./AcpLaunch";
import { approvePermission, refusePermission } from "./AcpPermissions";
import { requireManagedAntigravityConfiguration } from "./AntigravityConfiguration";

import type { AcpDriver, AcpSessionProfile } from "./AcpDriver";
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
    reportedOptions: {
      sessionMode: "mode",
      model: "model",
      reasoningEffort: "thinking_level",
    },
    matchesReportedModel: null,
    hasMcpStatusCommand: false,
    isContinuable: true,
    steps: (request) => [
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
      {
        id: "mode",
        value: mode === "yolo" ? "yolo" : "default",
        refusal: "plan_permission_mode_unenforceable",
      },
    ],
    decide: mode === "yolo" ? approvePermission : refusePermission,
  };
}

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
    if (purpose === "chat") throw new AgentError("antigravity_pica_unverified");
    return profile(mode);
  },
  plan: (specification) => ({
    environment: {
      [RUN_INSTANCE_VARIABLE]: specification.instanceId,
      BROWSER: "/bin/true",
    },
    mcpServers: pagesMcpServers(specification.instanceId, specification.mcp),
    sessionMeta: {
      antigravity: {
        ...(specification.profile.mode === "read_only"
          ? { enabledTools: ANTIGRAVITY_READ_TOOLS }
          : {}),
        eagerMcpServers: ["pages"],
      },
    },
  }),
  requireManagedConfiguration: requireManagedAntigravityConfiguration,
};

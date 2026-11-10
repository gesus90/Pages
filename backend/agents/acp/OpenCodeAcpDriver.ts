import { randomBytes } from "node:crypto";

import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";
import { SUPPORTED_OPENCODE_VERSION } from "@/backend/agents/cli/OpenCodeVersion";
import { AgentError } from "@/backend/error/AgentErrors";

import { requireManagedOpenCodeConfiguration } from "./OpenCodeAcpConfiguration";
import { pagesMcpServers } from "./AcpLaunch";
import {
  OPENCODE_DECISION_MODE,
  OPENCODE_DECISION_PERMISSIONS,
  OPENCODE_PICA_MODE,
  OPENCODE_PICA_PERMISSIONS,
  openCodeAcpProfile,
  openCodePlanPermissions,
} from "./OpenCodeAcpProfile";

import type { AcpDriver, AcpLaunchSpecification } from "./AcpDriver";

/** The managed agent and rules of a session: Pica's build, a decision without tools, or a plan mode. */
function sessionAgent(specification: AcpLaunchSpecification): {
  readonly mode: string;
  readonly permission: Readonly<Record<string, unknown>>;
  readonly isPica: boolean;
} {
  // Full access of an agent employee runs the stock agent of its plan mode; only Pica's chat runs the Pages build.
  const isPica =
    specification.purpose === "chat" &&
    specification.profile.mode === "read_only";
  if (isPica)
    return {
      mode: OPENCODE_PICA_MODE,
      permission: OPENCODE_PICA_PERMISSIONS,
      isPica,
    };
  // The group observer (PAGE-296) runs the same agent without any tool.
  if (
    specification.purpose === "decision" ||
    specification.purpose === "observer"
  )
    return {
      mode: OPENCODE_DECISION_MODE,
      permission: OPENCODE_DECISION_PERMISSIONS,
      isPica,
    };
  return {
    mode: specification.profile.permissions.sessionMode ?? "",
    permission: openCodePlanPermissions(specification.profile.mode),
    isPica,
  };
}

/**
 * The installed native `opencode acp` contract for Pica and plan nodes.
 * No external adapter, alternate model, user config or updater is involved.
 * A conversation brings Pica's bridge itself, so its launch names no MCP
 * server.
 */
export const OPENCODE_ACP_DRIVER: AcpDriver = {
  provider: "opencode",
  binary: "opencode",
  arguments: ["acp", "--port", "0", "--hostname", "127.0.0.1"],
  supportedVersions: SUPPORTED_OPENCODE_VERSION,
  errors: {
    modeRequired: "opencode_permission_mode_required",
    adapterMissing: "cli_not_found",
    adapterUnsupported: "opencode_acp_unsupported",
    sessionFailed: "opencode_acp_session_failed",
  },
  steeringMeta: null,
  isSupportedAdapter: (agent): agent is NonNullable<typeof agent> =>
    agent?.name === "OpenCode" && agent.version === SUPPORTED_OPENCODE_VERSION,
  profile: openCodeAcpProfile,
  plan: (specification) => {
    const { model } = specification;
    if (!model) throw new AgentError("plan_model_unavailable");
    const modelProvider = model.model.split("/")[0];
    const isChat = specification.purpose === "chat";
    const isDecision =
      specification.purpose === "decision" ||
      specification.purpose === "observer";
    const { mode, permission, isPica } = sessionAgent(specification);
    return {
      environment: {
        [RUN_INSTANCE_VARIABLE]: specification.instanceId,
        OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("base64url"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: model.model,
          small_model: model.model,
          enabled_providers: [modelProvider],
          default_agent: mode,
          share: "disabled",
          autoupdate: false,
          permission,
          agent: {
            [mode]: {
              mode: "primary",
              model: model.model,
              variant: model.reasoningEffort ?? "default",
              permission,
            },
            ...(!isPica
              ? {
                  build: { disable: true },
                  plan: { disable: true },
                  general: {
                    model: model.model,
                    variant: model.reasoningEffort ?? "default",
                  },
                  explore: {
                    model: model.model,
                    variant: model.reasoningEffort ?? "default",
                  },
                }
              : {}),
            title: { disable: true },
            summary: { disable: true },
            compaction: {
              model: model.model,
              variant: model.reasoningEffort ?? "default",
            },
          },
          compaction: { auto: true },
        }),
      },
      mcpServers:
        isChat || isDecision ? [] : pagesMcpServers(specification.mcp),
      sessionMeta: {},
    };
  },
  requireManagedConfiguration: requireManagedOpenCodeConfiguration,
};

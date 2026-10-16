import { randomBytes } from "node:crypto";

import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";
import { SUPPORTED_OPENCODE_VERSION } from "@/backend/agents/cli/OpenCodeVersion";
import { AgentError } from "@/backend/error/AgentErrors";

import { requireManagedOpenCodeConfiguration } from "./OpenCodeAcpConfiguration";
import { pagesMcpServers } from "./AcpLaunch";
import {
  OPENCODE_PICA_MODE,
  openCodeAcpProfile,
  openCodePlanPermissions,
} from "./OpenCodeAcpProfile";

import type { AcpDriver } from "./AcpDriver";

/**
 * The installed native `opencode acp` contract for Pica and plan nodes.
 * No external adapter, alternate model, user config or updater is involved.
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
    const mode = specification.profile.permissions.sessionMode;
    const permission = isChat
      ? { "*": "deny", "pages_*": "allow" }
      : openCodePlanPermissions(specification.profile.mode);
    return {
      environment: {
        [RUN_INSTANCE_VARIABLE]: specification.instanceId,
        OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("base64url"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: model.model,
          small_model: model.model,
          enabled_providers: [modelProvider],
          default_agent: isChat ? OPENCODE_PICA_MODE : mode,
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
            ...(!isChat
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
      mcpServers: isChat
        ? []
        : pagesMcpServers(specification.instanceId, specification.mcp),
      sessionMeta: {},
    };
  },
  requireManagedConfiguration: requireManagedOpenCodeConfiguration,
};

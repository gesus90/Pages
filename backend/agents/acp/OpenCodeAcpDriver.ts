import { randomBytes } from "node:crypto";

import { RUN_INSTANCE_VARIABLE } from "@/backend/agents/cli/CliProcessScan";
import { AgentError } from "@/backend/error/AgentErrors";

import { requireManagedOpenCodeConfiguration } from "./OpenCodeAcpConfiguration";
import {
  OPENCODE_PICA_MODE,
  OPENCODE_PICA_PROFILE,
} from "./OpenCodeAcpProfile";

import type { AcpDriver } from "./AcpDriver";

/**
 * The installed native `opencode acp` contract verified for Pica (PAGE-91).
 * No external adapter, alternate model, user config or updater is involved.
 */
export const OPENCODE_ACP_DRIVER: AcpDriver = {
  provider: "opencode",
  binary: "opencode",
  arguments: ["acp", "--port", "0", "--hostname", "127.0.0.1"],
  supportedVersions: "1.18.34",
  errors: {
    modeRequired: "opencode_chat_mode_required",
    adapterMissing: "cli_not_found",
    adapterUnsupported: "opencode_acp_unsupported",
    sessionFailed: "opencode_acp_session_failed",
  },
  steeringMeta: null,
  isSupportedAdapter: (agent): agent is NonNullable<typeof agent> =>
    agent?.name === "OpenCode" && agent.version === "1.18.34",
  profile: (mode, purpose) => {
    if (purpose !== "chat" || mode !== "read_only")
      throw new AgentError("opencode_chat_mode_required");
    return OPENCODE_PICA_PROFILE;
  },
  plan: (specification) => {
    const { model } = specification;
    if (!model) throw new AgentError("plan_model_unavailable");
    const modelProvider = model.model.split("/")[0];
    const permission = { "*": "deny", "pages_*": "allow" };
    return {
      environment: {
        [RUN_INSTANCE_VARIABLE]: specification.instanceId,
        OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("base64url"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: model.model,
          small_model: model.model,
          enabled_providers: [modelProvider],
          default_agent: OPENCODE_PICA_MODE,
          share: "disabled",
          autoupdate: false,
          permission,
          agent: {
            [OPENCODE_PICA_MODE]: {
              mode: "primary",
              model: model.model,
              variant: model.reasoningEffort ?? "default",
              permission,
            },
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
      mcpServers: [],
      sessionMeta: {},
    };
  },
  requireManagedConfiguration: requireManagedOpenCodeConfiguration,
};

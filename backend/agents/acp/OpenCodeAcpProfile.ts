import { refusePermission } from "./AcpPermissions";

import type { AcpSessionProfile } from "./AcpDriver";

/** The managed OpenCode agent whose only tools come from the Pica bridge. */
export const OPENCODE_PICA_MODE = "pages-pica";

/**
 * Pica's native OpenCode profile: no shell, files, delegation or unmanaged MCP.
 * The process configuration denies every tool except `pages_*`, which the
 * bridge checks per call. Unexpected permission requests are refused.
 */
export const OPENCODE_PICA_PROFILE: AcpSessionProfile = {
  mode: "read_only",
  unattended:
    "Native OpenCode ACP with only the authorized Pica tool bridge; every other tool is denied",
  permissions: {
    permissionMode: "read_only",
    sessionMode: OPENCODE_PICA_MODE,
    tools: "Pica tool bridge only",
    files: "none",
    shell: "off",
    web: "off",
    settings: "Pages managed only",
    mcpServers: "Pica tool bridge only",
  },
  reportedOptions: {
    sessionMode: "mode",
    model: "model",
    reasoningEffort: "effort",
  },
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => [
    {
      id: "mode",
      value: OPENCODE_PICA_MODE,
      refusal: "plan_permission_mode_unenforceable",
    },
    { id: "model", value: request.model, refusal: "plan_model_unavailable" },
    {
      id: "effort",
      value: request.reasoningEffort ?? "default",
      refusal: "plan_reasoning_unsupported",
      isOptional: request.reasoningEffort === null,
    },
  ],
  decide: refusePermission,
};

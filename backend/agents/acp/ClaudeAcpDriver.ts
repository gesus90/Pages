import { AgentError } from "@/backend/error/AgentErrors";

import {
  CLAUDE_ACP_BINARY,
  isSupportedClaudeAcp,
  planClaudeAcpLaunch,
} from "./ClaudeAcpAdapter";
import { claudeAcpProfile } from "./ClaudeAcpProfile";

import type { AcpDriver } from "./AcpDriver";

/**
 * The Claude CLI as an ACP runner, through the `claude-agent-acp` adapter.
 *
 * @remarks
 * No Claude configuration file can widen a session: the options of the
 * session turn the user and project settings off, so there is nothing to
 * refuse before the start.
 */
export const CLAUDE_ACP_DRIVER: AcpDriver = {
  provider: "claude_code",
  binary: CLAUDE_ACP_BINARY,
  supportedVersions: "0.90.x",
  errors: {
    modeRequired: "claude_permission_mode_required",
    adapterMissing: "plan_claude_acp_adapter_missing",
    adapterUnsupported: "plan_claude_acp_adapter_unsupported",
    sessionFailed: "plan_claude_acp_session_failed",
  },
  isSupportedAdapter: isSupportedClaudeAcp,
  profile: (mode, purpose) => {
    // Pica runs only on Codex over ACP; Claude Code keeps its plan nodes.
    if (purpose === "chat") throw new AgentError("provider_invalid");
    return claudeAcpProfile(mode);
  },
  plan: (specification) =>
    planClaudeAcpLaunch({
      ...specification,
      profile: claudeAcpProfile(specification.profile.mode),
    }),
  requireManagedConfiguration: () => Promise.resolve(),
};

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
 * refuse before the start. Plan nodes and Pica's conversation (PAGE-90) use
 * it, each with its own profile. A steer asks the adapter to hand a prompt
 * that finds no running turn back to Pages.
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
  steeringMeta: { steering: { idleBehavior: "promptRequired" } },
  isSupportedAdapter: isSupportedClaudeAcp,
  profile: claudeAcpProfile,
  plan: (specification) =>
    planClaudeAcpLaunch({
      ...specification,
      profile: claudeAcpProfile(
        specification.profile.mode,
        specification.purpose,
      ),
    }),
  requireManagedConfiguration: () => Promise.resolve(),
};
